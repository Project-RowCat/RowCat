import type { Story } from "@rowcat/domain";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { story, story_cover } from "../../db/schema.ts";
import type { NormalizedCover } from "../../lib/cover-image.ts";
import { notFound } from "../../lib/errors.ts";
import { getOwnedStory, type Tx } from "./index.ts";

/**
 * Cover writes: owner only, cover row only. It decides whether the story is this member's and
 * creates or deletes one `story_cover` row. Image validity is settled upstream
 * (`lib/cover-image.ts`) and the response shape is the route's.
 *
 * It issues no UPDATE against `story`, which makes all of these unrepresentable: `hidden`
 * releasing, `visibility` or adult rating changing, counters moving, and `updated_at` shifting so
 * the list reorders (the sort axis of `Published` is authoring edits, not pictures). When the cache
 * buster was `story.updated_at`, replacing a cover forced a story-row write and a promise to write
 * two tables in one transaction. Now cache identity is the cover's own generated column
 * (`db/tables/story.ts`), so bytes and version move in the same tuple and atomicity is by
 * definition.
 *
 * Ownership is in the predicate, not read-then-write: the story row is locked `FOR UPDATE` in the
 * transaction and the SELECT predicate is `id = :id AND owner = :ownerId`. Zero rows is a 404, the
 * same for a missing story and someone else's, or the cover path becomes an existence detector.
 *
 * The lock is for races with account or story deletion: normalization takes hundreds of
 * milliseconds and the account can vanish meanwhile. After locking one side finishes first
 * (deletion first: our SELECT finds zero rows, 404; ours first: deletion's cascade removes the new
 * cover), so no ownerless cover remains.
 *
 * Not here: image processing (not run inside the transaction, since it would hold one of ten pool
 * connections for hundreds of milliseconds), HTTP, cache headers, and cover history (one cover per
 * story, which the `story_cover` primary key already states).
 */

/**
 * Locks the story and confirms it is this member's, else 404. It returns nothing on purpose: if
 * callers started deciding on its result, those decisions would run outside the lock.
 */
async function lockOwnedStory(
	tx: Tx,
	storyId: string,
	ownerId: string,
): Promise<void> {
	const [owned] = await tx
		.select({ id: story.id })
		.from(story)
		.where(and(eq(story.id, storyId), eq(story.owner, ownerId)))
		.for("update")
		.limit(1);
	if (!owned) throw notFound("Story not found.");
}

/**
 * Preliminary ownership check, called by the route before reading the body.
 *
 * It does not lock; the authority is still `lockOwnedStory` (same transaction, `FOR UPDATE`). Its
 * job is to stop a 20MiB decode from starting against someone else's story. A missing story and
 * someone else's are the same 404.
 */
export async function assertStoryOwned(
	storyId: string,
	ownerId: string,
): Promise<void> {
	const [owned] = await db
		.select({ id: story.id })
		.from(story)
		.where(and(eq(story.id, storyId), eq(story.owner, ownerId)))
		.limit(1);
	if (!owned) throw notFound("Story not found.");
}

/**
 * Creates or replaces the cover in one statement.
 *
 * It is an upsert rather than `DELETE` then `INSERT` because if the second statement failed, a
 * replace would end as "cover gone entirely" though the user meant to change, not erase. One
 * statement has no such middle state.
 *
 * `updated_at` is an operational record, not cache identity, so it is bumped explicitly. `version`
 * is absent from `set`: it is a generated column, cannot be written and need not be (it changes
 * with the bytes).
 */
export async function setStoryCover(
	storyId: string,
	ownerId: string,
	cover: NormalizedCover,
): Promise<Story> {
	return db.transaction(async (tx) => {
		await lockOwnedStory(tx, storyId, ownerId);

		await tx
			.insert(story_cover)
			.values({
				story_id: storyId,
				bytes: cover.bytes,
				mime: cover.mime,
			})
			.onConflictDoUpdate({
				target: story_cover.story_id,
				set: {
					bytes: sql`excluded.bytes`,
					mime: sql`excluded.mime`,
					updated_at: sql`now()`,
				},
			});

		return readBack(tx, storyId, ownerId);
	});
}

/**
 * Deletes the cover; idempotent.
 *
 * Calling it again with no cover still succeeds and the `story` row does not move. Failing on a
 * missing cover would show an error to a retry that only lost its response, while the state the
 * user wanted (no cover) is already true.
 *
 * Ownership is checked even when there is no cover: if a DELETE against someone else's story could
 * return "success", that response would reveal the story has no cover.
 */
export async function removeStoryCover(
	storyId: string,
	ownerId: string,
): Promise<Story> {
	return db.transaction(async (tx) => {
		await lockOwnedStory(tx, storyId, ownerId);
		await tx.delete(story_cover).where(eq(story_cover.story_id, storyId));
		return readBack(tx, storyId, ownerId);
	});
}

/**
 * Re-reads the state just written inside the same transaction.
 *
 * Reading after commit would let another device change the cover again in between, and the returned
 * `coverUrl` would pose as this request's result without being it. It uses `getOwnedStory`, which
 * skips the viewing gate, on purpose: archiving, operator hiding and the adult display opt-in must
 * not stop someone reading their own story (publication's read makes the same call).
 */
async function readBack(
	tx: Tx,
	storyId: string,
	ownerId: string,
): Promise<Story> {
	const found = await getOwnedStory(storyId, ownerId, tx);
	/**
	 * The lock is held so it cannot vanish here; throwing keeps `null` from leaking out as the
	 * response if that invariant ever breaks (same shape as publication's `readBack`).
	 */
	if (!found) throw notFound("Story not found.");
	return found;
}
