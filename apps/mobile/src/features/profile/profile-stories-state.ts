/**
 * What the profile's works slot draws now. This axis is independent of identity.
 *
 * The file exists for that reason: if name and bio loaded but the works query failed, turning the
 * whole screen into an error would hide a person who can be seen, just because the list did not
 * arrive. The story detail and comments are split for the same reason (`comments-state.ts`).
 *
 * ## Blocking comes first
 *
 * The server returns zero works for a creator you blocked (list and total share one predicate).
 * From data alone, "blocked" and "has not posted anything" are the same value. Drawing the latter
 * copy would make the blocker think the creator has posted nothing, with no way to learn why.
 *
 * This screen does not re-decide that. `profileContentBlocked` in `@rowcat/domain` answers from
 * personalization state (the web calls the same function); only that boolean arrives here.
 *
 * Blocking also precedes loading. It is already known, so waiting for the query would flash a
 * placeholder before the same sentence on every visit to a blocked creator's profile.
 *
 * ## Held data is not replaced by failure: the axis is presence, not count
 *
 * A failed background refresh keeps the previously fetched pages in the cache (`status === "error"`
 * with `data` present). Flipping the screen to failure would lose one round trip but remove the
 * whole grid. The identity resolver looks at `data` first for the same reason (`if (data)` in
 * `profile-state.ts`).
 *
 * The axis is not `storyCount > 0`. That proxy folds "never received" and "received, zero results"
 * into one value. The latter is a valid server answer, so a later failed refresh would discard it
 * and claim ignorance. The snapshot therefore carries `hasData` explicitly (`data !== undefined`);
 * an empty `InfiniteData` still counts as data.
 *
 * ## No visibility decisions here
 *
 * Private, archived, adult-gate and operator-hidden are all server predicates. A work that reaches
 * this file is already a public work this viewer may see, so the file only knows a count. The
 * absence of work objects from the inputs is the boundary.
 */

export interface ProfileStoriesSnapshot {
	status: "pending" | "success" | "error";
	/** `fetchStatus === "paused"`: no network, retries stopped (`status` stays pending). */
	paused: boolean;
	/**
	 * Whether usable query data exists (`stories.data !== undefined`).
	 *
	 * Not `storyCount > 0`: a successful zero result is valid cached data, and folding it into the
	 * count would turn an empty state into a failure when a background refresh fails.
	 */
	hasData: boolean;
	/** Works count after the loaded pages are expanded. Meaningful only when `hasData` is true. */
	storyCount: number;
}

export interface ProfileStoriesStateInputs {
	/** Result of `profileContentBlocked(actions)`. False when there is no personalization. */
	blocked: boolean;
	stories: ProfileStoriesSnapshot;
}

/**
 * ```text
 * blocked   I have blocked this creator; the server returns zero works, and this says why
 * stories   cached data with works; drawn as-is even if a background refresh fails
 * empty     cached data with zero works; stays empty even if a background refresh fails
 * failed    never received, ended in error; the identity stays on screen
 * offline   paused with no network and no cached data
 * loading   first fetch still running
 * ```
 *
 * Checked top to bottom. Blocked is first and held data is second; the last three (failed, offline,
 * loading) apply only when nothing was ever received.
 */
export type ProfileStoriesState =
	| "blocked"
	| "loading"
	| "offline"
	| "failed"
	| "empty"
	| "stories";

export function resolveProfileStoriesState(
	inputs: ProfileStoriesStateInputs,
): ProfileStoriesState {
	if (inputs.blocked) return "blocked";

	const { status, paused, hasData, storyCount } = inputs.stories;
	/**
	 * Held data outranks status. If a background refresh fails (`status === "error"` while the held
	 * pages remain), draw the answer already received. This is the same rule as the identity resolver
	 * (`if (data)` in `profile-state.ts`) and the operations console's `query-state.ts`.
	 *
	 * Without this line, a grid of twenty-four works becomes an error message because one refresh
	 * failed. The guard also covers zero: with `storyCount > 0`, a later failure after a successful
	 * zero result would drop into `failed` and discard a known answer. Presence of data decides the
	 * branch; the count only chooses the copy within it.
	 */
	if (hasData) return storyCount > 0 ? "stories" : "empty";
	if (status === "error") return "failed";
	return paused ? "offline" : "loading";
}

/**
 * Whether the next page may be requested in this state.
 *
 * Keeps the screen from adding one more `hasNextPage && !isFetchingNextPage` check. React Native's
 * `onEndReached` can fire several times per scroll, and Query does not merge in-flight requests, so
 * these two guards together are all that prevents duplicate requests. No second lock is built by
 * hand (the discover screen follows the same rule).
 *
 * Always false outside the list state. Reaching the bottom in the blocked, empty or failed states
 * would re-request, get the same zero back, and change nothing.
 */
export const canLoadMoreProfileStories = (
	state: ProfileStoriesState,
	page: { hasNext: boolean; fetching: boolean },
): boolean => state === "stories" && page.hasNext && !page.fetching;

/**
 * Whether the list's end is drawn.
 *
 * Showing "you have reached the end" at zero collides with the empty-state guidance, so the end
 * appears only when there is a list (the web profile does the same).
 */
export const showsProfileStoriesEnd = (state: ProfileStoriesState): boolean =>
	state === "stories";
