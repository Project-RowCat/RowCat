import type { AutosaveSnapshot } from "./use-draft-autosave.ts";

/**
 * Whether the editor may be left. Pure so the rule is decided in one place, not per component.
 *
 * Blocks only when both are true:
 * - `status === "error"`: automatic retries are exhausted and the screen already reported the
 *   failure.
 * - `pending`: edits that could not be written are still queued.
 *
 * Without the first it is ordinary saving; neither the debounce (`pending`) nor an in-flight write
 * (`saving`) blocks, since neither has failed and the unmount flush usually succeeds. Prompting on
 * every 500ms typing gap would make the dialog unread. Without the second there is nothing to lose
 * (discarded or already written), so blocking on the status label alone forces a choice over
 * nothing.
 *
 * The user is never trapped: `Leave without saving` empties the queue before navigating. Leaving without
 * emptying lets the unmount flush rewrite the edit the user chose to discard.
 *
 * Only app-owned navigation can be intercepted (header back button, Android hardware back). The iOS
 * edge swipe and OS process kill are not covered and this does not pretend otherwise; their only
 * defence is the best-effort unmount/background flush (`use-draft-autosave.ts` header).
 */
export function shouldBlockLeave(snapshot: AutosaveSnapshot): boolean {
	return snapshot.status === "error" && snapshot.pending;
}

/**
 * Dialog copy states what is at stake and what can be chosen. "Are you sure you want to leave?"
 * says nothing and gets pressed unread.
 */
export const DRAFT_LEAVE_COPY = {
	title: "Your changes haven't been saved yet",
	description:
		"Edits that couldn't be saved on this device remain. If you leave now, they'll be lost.",
	retry: "Try again",
	discard: "Leave without saving",
	stay: "Stay on this screen",
} as const;
