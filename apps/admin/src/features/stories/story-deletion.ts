import type { AdminStoryDetailDto } from "@rowcat/contracts";

/**
 * What the story detail's deletion section draws, as a pure function (this app's tests do not
 * render React).
 *
 * ```text
 * hidden    not an admin — no section (do not draw a button that answers staff with 403)
 * blocked   enforcement exists — state the reason instead of a button (the server answers 409)
 * ready     pressable — the confirmation states the result up front
 * ```
 *
 * A confirmation that does not state the result goes unread. It also names what survives (media
 * bytes, reports), because "everything is deleted" would be false.
 */
export type StoryDeletionView =
	| { state: "hidden" }
	| { state: "blocked"; message: string }
	| { state: "ready"; consequence: string; confirmLabel: string };

/** Irreversible, so the operator types this phrase in addition to the reason. */
export const STORY_DELETE_ACKNOWLEDGEMENT = "Delete story";

export function storyDeletionView(
	detail: Pick<AdminStoryDetailDto, "actionCount">,
	canAdminister: boolean,
): StoryDeletionView {
	if (!canAdminister) return { state: "hidden" };
	if (detail.actionCount > 0)
		return {
			state: "blocked",
			message: `This story has ${detail.actionCount} moderation action records, so it can't be deleted. Deleting it would erase those enforcement records and appeals with it; handle it by hiding instead.`,
		};
	return {
		state: "ready",
		confirmLabel: "Delete story",
		consequence:
			"The story and its cover, runtime, comments, favorites and view records are deleted, and its address becomes a 404. This can't be undone. Report records and media originals (which the creator's draft may point at) remain.",
	};
}
