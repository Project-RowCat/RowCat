/**
 * Recording one view: **when it is sent** and **what happens when it fails**.
 *
 * The rule is short enough to want inside a component. But both rules below fail silently when
 * broken (the view count grows beyond reality, or a viewable work disappears into an error), so
 * they must be checkable without rendering.
 *
 * ## Receiving the data is not the reader seeing it
 *
 * Put this in `queryFn` or a loader and every prefetch, revalidation and background refresh becomes
 * a view. Those runs record "a request was made", not "a person looked". So this predicate is true
 * **only after the query succeeds**, and the screen sends once at that point.
 *
 * ## Deduplication is not done here
 *
 * The server already folds (work, viewer, UTC day) and does not count the author's own work
 * (`services/social.ts`). A seen-works list kept in SQLite or AsyncStorage would be a second source
 * of truth, and the copies would differ per device until neither could be trusted.
 */

/** Whether a view record may be sent in this query state: only after success. */
export const shouldRecordStoryView = (
	status: "pending" | "success" | "error",
): boolean => status === "success";

/**
 * Swallows the failure.
 *
 * A view count is a side effect, and even the server does not treat a failed record as fatal.
 * Throwing here would turn a viewable work into an error screen because of one network blip. No
 * retry either: resending gains nothing, and the user may have left the screen by then.
 */
export const recordStoryView = (
	record: (storyId: string) => Promise<void>,
	storyId: string,
): Promise<void> =>
	record(storyId).then(
		() => {},
		() => {},
	);
