/**
 * What the comment list draws right now. **An axis independent of the work.**
 *
 * This file exists for one reason. If the work info arrived but only the comment query failed,
 * turning the whole screen into an error would hide a work the reader can see because the
 * discussion failed to load. So the verdicts are split, and the detail screen draws the two values
 * **separately**.
 *
 * Ordering is not stacked inside the component, for the same reason as the discover screen:
 * offline, if `paused` is not checked, `status` stays `pending` and the user sees a placeholder
 * that never ends.
 */
export interface CommentsSnapshot {
	status: "pending" | "success" | "error";
	/** `fetchStatus === "paused"`: retries stopped with no network (`status` stays pending). */
	paused: boolean;
	/** Comment count after the accumulated pages are opened. */
	commentCount: number;
}

export type CommentsState = "loading" | "offline" | "failed" | "empty" | "list";

export function resolveCommentsState(
	snapshot: CommentsSnapshot,
): CommentsState {
	// Success is checked first: a failed background refresh still draws the rows already held.
	if (snapshot.status === "success")
		return snapshot.commentCount > 0 ? "list" : "empty";
	if (snapshot.status === "error") return "failed";
	return snapshot.paused ? "offline" : "loading";
}
