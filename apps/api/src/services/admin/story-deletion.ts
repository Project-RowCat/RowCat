import {
	ADMIN_STORY_DELETE_ERROR_CODE,
	type AdminStoryDeleteOutcome,
} from "@rowcat/contracts";
import { eq } from "drizzle-orm";
import { db } from "../../db/client.ts";
import { moderation_action, story } from "../../db/schema.ts";
import { ApiError, notFound } from "../../lib/errors.ts";
import { recordAudit } from "./audit.ts";

/**
 * Operator deletion of a published story: one irreversible operation, one transaction. It is the
 * hand of the operator's contact channel (creators have no in-app deletion); see
 * `AdminStoryDeleteRequest` in `packages/contracts/src/admin.ts`.
 *
 * Order: lock the row (`FOR UPDATE`; a missing row is a 404, which also separates a second call),
 * check the action ledger (409 before anything is written), delete, then one audit row in the same
 * transaction so a failed audit undoes the deletion.
 *
 * Any enforcement blocks deletion, active or reversed: `moderation_action.target_story` cascades,
 * so deleting the row would erase the enforcement and its appeals, and that ledger is the audit
 * authority. Such a story is handled by hiding. Comment-deletion actions do not reference the story
 * by FK (they carry a snapshot), so they neither vanish with it nor block here.
 *
 * Removed with the row by FK: cover, runtime, media references, comments, favorites, view and play
 * logs. A notification's story reference is `set null`, so the row stays without a destination.
 * Media bytes are kept because a device draft may still point at them and republishing needs them.
 * Reports and cases are kept too: a reporter's `My reports` does not re-query the target, and account
 * deletion erases cases only because it erases an identity. Open cases are closed from the queue.
 */
export async function deleteStoryAsOperator(input: {
	storyId: string;
	operatorId: string;
	reason: string;
}): Promise<AdminStoryDeleteOutcome> {
	return db.transaction(async (tx) => {
		const [row] = await tx
			.select({
				id: story.id,
				owner: story.owner,
				title: story.title,
				visibility: story.visibility,
			})
			.from(story)
			.where(eq(story.id, input.storyId))
			.for("update");
		if (!row) throw notFound("Story not found.");

		const [enforced] = await tx
			.select({ id: moderation_action.id })
			.from(moderation_action)
			.where(eq(moderation_action.target_story, row.id))
			.limit(1);
		if (enforced)
			throw new ApiError(
				409,
				ADMIN_STORY_DELETE_ERROR_CODE.enforcement,
				"This story has moderation action records, so it can't be deleted. Handle it by hiding it.",
			);

		await tx.delete(story).where(eq(story.id, row.id));
		const outcome: AdminStoryDeleteOutcome = "deleted";

		/**
		 * Same transaction. The title is carried because this row is the only answer to "what was
		 * deleted" once the row is gone.
		 */
		await recordAudit(tx, {
			operatorId: input.operatorId,
			action: "admin.story.delete",
			targetType: "story",
			targetId: row.id,
			metadata: {
				reason: input.reason,
				outcome,
				title: row.title,
				previousVisibility: row.visibility,
				hadOwner: row.owner !== null,
			},
		});
		return outcome;
	});
}
