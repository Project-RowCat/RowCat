import {
	STORY_LIFECYCLE_ERROR_CODE,
	STORY_PUBLISH_ERROR_CODE,
} from "@rowcat/contracts";
import type { StoryLifecycleAction } from "@rowcat/domain";
import { isRowCatApiError } from "@rowcat/sdk";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Lifecycle actions on the `Published` row and the copy that describes them. Kept out of the component
 * because every string here is a promise. A confirm that disagrees with server behavior harms the
 * user in an irreversible direction, so these strings must be checkable without rendering. Hence no
 * React in this file.
 *
 * Which actions confirm:
 * - publish and unlist confirm: the work becomes visible to others. Unlist sounds private, so the
 *   copy must say the work opens to anyone with the link, before the press.
 * - archive confirms: it leaves public surfaces and reads as deletion.
 * - unpublish and restore do not confirm: a mistake is reversed by publishing again, and restore
 *   changes nothing visible.
 */

/** Row button labels. The label alone must say what the action does. */
export const workLifecycleLabel = (action: StoryLifecycleAction): string =>
	translator("create")(`lifecycle.label.${action}`);

/**
 * Pending labels. Same words with `…` appended, so the user still sees which action was pressed.
 */
export const workLifecyclePendingLabel = (
	action: StoryLifecycleAction,
): string => translator("create")(`lifecycle.pending.${action}`);

/**
 * Confirm dialog content must state four things: what happens, where, the result, and how to undo
 * it. A generic `Are you sure?` gives no information. It gets pressed without being read, and the
 * dialog becomes a second click. Same rule as the required `consequence` field of the ops console
 * `ConfirmDialog`.
 */
export interface WorkLifecycleConfirm {
	title: string;
	/**
	 * What happens. Several lines are allowed because the dialog must also say what does not happen.
	 */
	lines: string[];
	confirmLabel: string;
	/** Not irreversible, so no destructive emphasis. This includes `Archived`. */
	destructive: boolean;
}

/**
 * Returns the confirm copy for an action, or null to run it immediately. The archive copy must open
 * with `it is not deleted`. `Archived` reads as removal to most people, and without this sentence the user
 * believes the data is gone, which cannot be corrected. Restore's change back to private is
 * announced here, in the archive confirm, because restore has no confirm of its own. The promise
 * must be read before archiving.
 */
export function workLifecycleConfirm(
	action: StoryLifecycleAction,
	title: string,
): WorkLifecycleConfirm | null {
	const t = translator("create");
	switch (action) {
		case "publish":
			return {
				title: t("lifecycle.publish.title", { title }),
				lines: [
					t("lifecycle.publish.line1"),
					t("lifecycle.publish.line2"),
					t("lifecycle.publish.line3"),
				],
				confirmLabel: t("lifecycle.publish.confirm"),
				destructive: false,
			};
		case "unlist":
			return {
				title: t("lifecycle.unlist.title", { title }),
				lines: [
					t("lifecycle.unlist.line1"),
					t("lifecycle.unlist.line2"),
					t("lifecycle.unlist.line3"),
				],
				confirmLabel: t("lifecycle.unlist.confirm"),
				destructive: false,
			};
		case "archive":
			return {
				title: t("lifecycle.archive.title", { title }),
				lines: [
					t("lifecycle.archive.line1"),
					t("lifecycle.archive.line2"),
					t("lifecycle.archive.line3"),
				],
				confirmLabel: t("lifecycle.archive.confirm"),
				destructive: false,
			};
		/**
		 * Runs without confirmation. Both actions reduce exposure or leave it unchanged, so a mistaken
		 * press cannot make the work more visible.
		 */
		case "unpublish":
		case "restore":
			return null;
	}
}

/**
 * Failure copy is chosen by the server error code, not the HTTP status. Both rejections are 409 but
 * need different user actions. Both codes only fire when the list is stale. The screen renders only
 * the actions valid right now (`storyLifecycleActions`), so the cause is a change from another
 * device or tab. Hence the copy says to reload the list, not to retry.
 */
export function workLifecycleErrorMessage(
	action: StoryLifecycleAction,
	error: unknown,
): string {
	const t = translator("create");
	if (isRowCatApiError(error)) {
		if (error.code === STORY_LIFECYCLE_ERROR_CODE.archived)
			return t("lifecycle.error.archived");
		if (error.code === STORY_LIFECYCLE_ERROR_CODE.notArchived)
			return t("lifecycle.error.notArchived");
		/**
		 * The adult-content gate applies only to the two outward actions, publish and unlist. The user's
		 * fix is identity verification, not a retry. A generic failure message would be a dead end.
		 */
		if (error.code === STORY_PUBLISH_ERROR_CODE.adultNotPermitted)
			return t("lifecycle.error.adult");
		if (error.status === 404) return t("lifecycle.error.notFound");
		if (error.status === 403)
			/**
			 * Capability and publish-block limits apply only to publish and unlist, so the copy splits on
			 * those two. Other actions get a generic cannot-do-this-now message.
			 */
			return action === "publish" || action === "unlist"
				? t("lifecycle.error.cannotExpose")
				: t("lifecycle.error.cannotAct");
	}
	return t(`lifecycle.failed.${action}`);
}
