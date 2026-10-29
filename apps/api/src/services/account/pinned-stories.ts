import { PINNED_STORY_ERROR_CODE } from "@rowcat/contracts";
import { type CreatorWork, isPinnableWork } from "@rowcat/domain";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { member, profile_pinned_story, story } from "../../db/schema.ts";
import { ApiError, notFound } from "../../lib/errors.ts";
import { listOwnPinnedWorks } from "../story/index.ts";

/**
 * Replace the pinned works with the desired final list wholesale.
 *
 * The contract already rejects over-cap and duplicate lists (`PinnedStoriesUpdateDto`); this
 * function asks one more thing per story, whether it may stand in this slot:
 *
 * ```text
 * is it mine              story.owner = session's member    otherwise refuse
 * newly pinned            currently public, not hidden      otherwise refuse
 * already pinned          exposure not asked                can stay as is
 * ```
 *
 * The third row is the point (`profile-pins.ts` header in `@rowcat/domain`): if reordering the rest
 * were refused because one pinned work was briefly turned private, the person would have to
 * republish it or drop the pin just to reorder.
 *
 * Refusal is one code (`pinned_story_unavailable`); splitting missing, someone else's and
 * non-public would let probing with other people's ids detect existence. A refused request changes
 * no row, otherwise the saved list diverges from the one the screen sent.
 *
 * The member row is locked: two devices of one person saving at once both delete and reinsert, and
 * without the lock the inserts interleave, positions collide (`uq_profile_pinned_story_position`)
 * and one gets a
 * 500. With the lock the later request overwrites the earlier, which is right for a write that
 *      carries the final state (avatar replacement locks the same row for the same reason).
 *
 * The response is the owner's list re-read in the same transaction, never built from the sent ids:
 * the screen draws title, cover and exposure, which only the server knows.
 */
export async function replaceOwnPinnedStories(
	memberId: string,
	storyIds: readonly string[],
): Promise<CreatorWork[]> {
	return db.transaction(async (tx) => {
		const [owner] = await tx
			.select({ id: member.id })
			.from(member)
			.where(eq(member.id, memberId))
			.for("update")
			.limit(1);
		/** Concurrent account deletion; the viewer is already resolved, so this is practically unreachable. */
		if (!owner) throw notFound("Member not found.");

		if (storyIds.length > 0) {
			const [existing, candidates] = await Promise.all([
				tx
					.select({ storyId: profile_pinned_story.story_id })
					.from(profile_pinned_story)
					.where(eq(profile_pinned_story.member_id, memberId)),
				tx
					.select({
						id: story.id,
						visibility: story.visibility,
						hidden: story.hidden,
					})
					.from(story)
					.where(
						and(inArray(story.id, [...storyIds]), eq(story.owner, memberId)),
					),
			]);
			const kept = new Set(existing.map((row) => row.storyId));
			const owned = new Map(candidates.map((row) => [row.id, row]));
			const allowed = storyIds.every((id) => {
				const work = owned.get(id);
				if (!work) return false;
				return kept.has(id) || isPinnableWork(work);
			});
			if (!allowed)
				throw new ApiError(
					409,
					PINNED_STORY_ERROR_CODE.unavailable,
					"Some stories can't be pinned. Refresh the list and choose again.",
				);
		}

		await tx
			.delete(profile_pinned_story)
			.where(eq(profile_pinned_story.member_id, memberId));
		if (storyIds.length > 0)
			await tx.insert(profile_pinned_story).values(
				storyIds.map((storyId, position) => ({
					member_id: memberId,
					story_id: storyId,
					position,
				})),
			);

		return listOwnPinnedWorks(memberId, tx);
	});
}
