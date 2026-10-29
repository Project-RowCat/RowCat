import { STORY_LIFECYCLE_ERROR_CODE } from "@rowcat/contracts";
import type { Story, StoryVisibility } from "@rowcat/domain";
import { and, eq } from "drizzle-orm";
import type { Viewer } from "../../auth/viewer.ts";
import { db } from "../../db/client.ts";
import { story } from "../../db/schema.ts";
import { ApiError, notFound } from "../../lib/errors.ts";
import { getOwnedStory, type Tx } from "./index.ts";
import { requireAdultPublishEligibility } from "./publication.ts";
import { notifyFollowersOfNewPublicStory } from "./publication-notice.ts";

/**
 * Story lifecycle: the five operations that move the visibility of an already published story.
 *
 * Kept apart from publication (`services/story/publication.ts`), which replaces the whole authoring
 * snapshot and therefore needs the draft (`originDraftId` is required). This file touches no
 * authored content, so a creator who published from another device or deleted the draft can still
 * take their story down and bring it back.
 *
 * The only column written is `story.visibility`, which makes these unrepresentable: releasing
 * `hidden` (the creator cannot undo enforcement), changing the rating, changing authored content,
 * resetting counters (views and favorites belong to readers), losing the cover (`story_cover` is a
 * separate table). `updated_at` is not bumped either: it is the authoring edit time and the sort
 * axis of the published list, and archiving is not an edit (`setStoryHidden` leaves it for the same
 * reason).
 *
 * Ownership is in the predicate with a lock in front of it: the story row is `FOR UPDATE` locked
 * inside the transaction and the SELECT matches `id = :id AND owner = :ownerId`. Zero rows is a 404
 * that is the same for a missing story and someone else's, so this path cannot detect that an id
 * exists. The lock is for contention: with `archive` and `publish` arriving together, the second
 * decides on top of the first's result, so the final state always went through one transition this
 * table allows.
 *
 * All five are idempotent: a request for the state already true succeeds, so a retry that only lost
 * its response is not drawn as a failure. Rejection is only for a different transition:
 *
 * ```text
 * publish   <- archived            409 story_archived      restore first
 * unlist    <- archived            409 story_archived      same
 * unpublish <- archived            409 story_archived      same; never silently restores
 * restore   <- public / unlisted   409 story_not_archived  no visibility reduction nobody asked for
 * ```
 */

interface LockedStory {
	visibility: StoryVisibility;
	adult: boolean;
}

/**
 * Locks the story and checks it belongs to this member; 404 otherwise. Returns only the two axes
 * the decision needs: a whole row would invite callers to decide other things on values the lock
 * was not meant to protect.
 */
async function lockOwnedStory(
	tx: Tx,
	storyId: string,
	ownerId: string,
): Promise<LockedStory> {
	const [row] = await tx
		.select({ visibility: story.visibility, adult: story.adult })
		.from(story)
		.where(and(eq(story.id, storyId), eq(story.owner, ownerId)))
		.for("update")
		.limit(1);
	if (!row) throw notFound("Story not found.");
	return row;
}

const archived = (): never => {
	throw new ApiError(
		409,
		STORY_LIFECYCLE_ERROR_CODE.archived,
		"This story is archived. Restore it first.",
	);
};

/**
 * Moves visibility and re-reads the story inside the same transaction. Reading after commit would
 * let another device move it again and return a state this request did not produce. `getOwnedStory`
 * skips the viewing gate on purpose: archiving, operator hiding and the adult opt-in must not stop
 * a creator reading their own story (a gallery predicate would make a successful archive answer
 * 404).
 */
async function moveTo(
	tx: Tx,
	storyId: string,
	ownerId: string,
	visibility: StoryVisibility,
): Promise<Story> {
	await tx
		.update(story)
		.set({ visibility })
		/** The lock already guards this; kept so the boundary is visible in this one statement. */
		.where(and(eq(story.id, storyId), eq(story.owner, ownerId)))
		.returning({ id: story.id });

	const updated = await getOwnedStory(storyId, ownerId, tx);
	// A vanished locked row is a state we do not know; surface it rather than invent one.
	if (!updated)
		throw new Error(
			`couldn't read the story after the lifecycle transition: ${storyId}`,
		);
	return updated;
}

/**
 * Private or unlisted to public, the only lifecycle transition that enters the catalogue, so it
 * alone re-checks eligibility. The route already passed `requireActiveViewer`, the `story.publish`
 * capability and the publish breaker; here adult eligibility is judged from the stored row's rating
 * (the request has no body), since a member eligible at publication may have lost it. `hidden` is
 * deliberately not checked: raising a hidden story to public still shows it to nobody
 * (`galleryWhere` requires `hidden = false`) and the `operator-hidden` badge says so; blocking here would
 * leave that story unable to become public even after the hiding is lifted.
 */
export async function publishStoryPublicly(
	viewer: Viewer,
	storyId: string,
): Promise<Story> {
	return db.transaction(async (tx) => {
		const locked = await lockOwnedStory(tx, storyId, viewer.id);
		if (locked.visibility === "archived") archived();
		requireAdultPublishEligibility(viewer, locked.adult);
		// Already-public issues the same statement: nothing changes, and a branch would let retry and
		// first call take different code (and only one check eligibility).
		const updated = await moveTo(tx, storyId, viewer.id, "public");
		// The follower notice attaches to this transition only. The origin comes from the locked row so a
		// concurrent transition cannot make "already public" read as "first time"; a retry on an
		// already-public story writes nothing. Same transaction: outside it, a rolled-back publish would
		// leave a notification pointing at a 404.
		await notifyFollowersOfNewPublicStory(tx, {
			storyId,
			creatorId: viewer.id,
			before: locked.visibility,
			after: "public",
		});
		return updated;
	});
}

/**
 * Private or public to unlisted: out of lists, open by address.
 *
 * The direction depends on the origin (private raises exposure, public lowers it). The gate does
 * not compute it and aligns with the raising side, going through the same door as `publish`
 * (`requireActiveViewer`, `story.publish`, publish breaker, locked row's adult eligibility). That
 * is no dead end because the withdrawing paths stay open: a sanctioned creator can still
 * `unpublish` and `archive` (both `requireViewer`), losing only the ability to raise exposure.
 * Adult eligibility follows `publish` because an unlisted story opens to anyone with the address,
 * which is no different legally from the catalogue.
 */
export async function unlistStory(
	viewer: Viewer,
	storyId: string,
): Promise<Story> {
	return db.transaction(async (tx) => {
		const locked = await lockOwnedStory(tx, storyId, viewer.id);
		if (locked.visibility === "archived") archived();
		requireAdultPublishEligibility(viewer, locked.adult);
		return moveTo(tx, storyId, viewer.id, "unlisted");
	});
}

/**
 * Public or unlisted to private. A withdrawing transition, so it asks for no eligibility or
 * capability: a member who lost adult eligibility needs it most, and blocking them from taking
 * their own adult story down would be the opposite of safety. Not for archived stories: that is a
 * restore, which has its own name, and accepting it here would be a second way to lift archiving.
 */
export async function unpublishStory(
	viewer: Viewer,
	storyId: string,
): Promise<Story> {
	return db.transaction(async (tx) => {
		const locked = await lockOwnedStory(tx, storyId, viewer.id);
		if (locked.visibility === "archived") archived();
		return moveTo(tx, storyId, viewer.id, "private");
	});
}

/**
 * Public, unlisted or private to archived. Does not delete: the playback payload, cover, counts,
 * favorites, comments and draft all remain, which the single written column guarantees.
 * Operator-hidden stories can be archived too; `hidden` stays, so restoring later still leaves them
 * hidden and archiving cannot erase enforcement. Re-archiving succeeds (state already true).
 */
export async function archiveStory(
	viewer: Viewer,
	storyId: string,
): Promise<Story> {
	return db.transaction(async (tx) => {
		await lockOwnedStory(tx, storyId, viewer.id);
		return moveTo(tx, storyId, viewer.id, "archived");
	});
}

/**
 * Archived to private, never public or unlisted. Archiving usually means "not offering this now";
 * returning to the catalogue on one press would republish a months-old story without confirmation,
 * so republishing is an explicit second operation. The pre-archive state is not remembered, since
 * `restore`'s result would then depend on a state months old that the user cannot know before
 * pressing (same judgement as unblock not reviving a follow). Already private succeeds
 * (idempotent); public or unlisted is 409, because silently lowering it would be a visibility
 * reduction nobody requested.
 */
export async function restoreStory(
	viewer: Viewer,
	storyId: string,
): Promise<Story> {
	return db.transaction(async (tx) => {
		const locked = await lockOwnedStory(tx, storyId, viewer.id);
		// Stories open from outside are not quietly taken down; that has the name `unpublish`.
		if (locked.visibility === "public" || locked.visibility === "unlisted")
			throw new ApiError(
				409,
				STORY_LIFECYCLE_ERROR_CODE.notArchived,
				"This story isn't archived.",
			);
		return moveTo(tx, storyId, viewer.id, "private");
	});
}
