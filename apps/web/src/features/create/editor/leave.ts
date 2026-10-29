import { translator } from "#/lib/i18n/current.ts";
import type { AutosaveSnapshot } from "./use-autosave.ts";

/**
 * Decides whether the editor may be left. It is a pure function because both possible errors are
 * silent: blocking too often shows a dialog after every normal pause, and blocking too rarely
 * silently drops edits the screen had already reported as failed.
 *
 * Blocks only when both conditions hold:
 * - status === "error": automatic retries are exhausted and the screen has said so.
 * - pending === true: an edit that could not be written is still in the queue.
 *
 * Debounce and in-flight saves do not block: nothing has failed, and the final flush on unmount
 * usually succeeds. A failure with nothing pending does not block either, because nothing is at
 * stake. Blocking does not trap the user: the dialog's discard option empties the queue before
 * navigating, since a flush during unmount could otherwise write the discarded edits back.
 */
export function shouldBlockLeave(snapshot: AutosaveSnapshot): boolean {
	return snapshot.status === "error" && snapshot.pending;
}

/**
 * Dialog copy. It states what is at stake and what the user can choose. A generic question such as
 * `Are you sure you want to leave?` is avoided: it carries no information, gets dismissed unread, and this dialog asks
 * about something that really is irreversible.
 */
export const draftLeaveCopy = () => {
	const t = translator("create");
	return {
		title: t("leave.title"),
		description: t("leave.description"),
		retryFailed: t("leave.retryFailed"),
		stay: t("leave.stay"),
		retry: t("leave.retry"),
		retrying: t("leave.retrying"),
		discard: t("leave.discard"),
	} as const;
};
