/**
 * The workspace's four tabs: vocabulary and address representation (same role and rules as the
 * web's `create-search.ts`).
 *
 * The address owns which tab is active. `useState("drafts")` would break back navigation and lose
 * the tab after visiting a work detail; device storage would hand the last person's tab to the next
 * person on a shared device. No shadow state beside the address: with both, there is no way to
 * decide which to trust when they disagree (same axis as reading the active room only from the
 * route param).
 *
 * Pure because this app's tests do not render React; mistakes here are silent (one hand-edited
 * character turns the workspace into an error screen, or a default left in the address gives one
 * screen two addresses).
 */

/**
 * Four tabs, same vocabulary and order as the web's `/create`. No pre-reserved `settings` slot: a
 * vocabulary value makes the screen draw at least a disabled row, which users read as a coming
 * feature. `analytics` and `comments` entered together with the screens that draw them.
 */
import {
	CREATOR_ANALYTICS_WINDOWS,
	type CreatorAnalyticsWindow,
	DEFAULT_CREATOR_ANALYTICS_WINDOW,
} from "@rowcat/domain";

export const CREATE_VIEWS = [
	"drafts",
	"published",
	"analytics",
	"comments",
] as const;
export type CreateView = (typeof CREATE_VIEWS)[number];

/**
 * Default tab is drafts: people entering usually resume a manuscript, and this tab draws without
 * the server. Defaulting to `Published` or `Analytics` would show an offline user an error on opening
 * `/create`.
 */
export const DEFAULT_CREATE_VIEW: CreateView = "drafts";

const KNOWN = new Set<string>(CREATE_VIEWS);

/**
 * The tab the address names; unknown values fold to the default. Never throw: a one-character
 * deep-link typo turning the workspace into an error screen reads as the drafts having vanished,
 * though they are still on the device. expo-router search params can be arrays (`?view=a&view=b`);
 * only the first is read.
 */
export function readCreateViewParam(
	raw: string | string[] | undefined,
): CreateView {
	const value = Array.isArray(raw) ? raw[0] : raw;
	return typeof value === "string" && KNOWN.has(value)
		? (value as CreateView)
		: DEFAULT_CREATE_VIEW;
}

/**
 * `setParams` argument for that tab. The default is explicitly `undefined` because
 * `router.setParams` merges: omitting the key keeps the previous value, so returning from `Published`
 * to `Drafts` would not reset. Passing the default as a string would give one screen two addresses.
 */
export const createViewParams = (
	view: CreateView,
): { view: string | undefined } => ({
	view: view === DEFAULT_CREATE_VIEW ? undefined : view,
});

/**
 * Analytics window: same word as the web's `?window=`, kept in the address for the same reason as
 * the tab (back and re-entry open the same window). Values outside the vocabulary fall to the
 * default.
 */
const KNOWN_WINDOWS = new Set<string>(CREATOR_ANALYTICS_WINDOWS);

export function readAnalyticsWindowParam(
	raw: string | string[] | undefined,
): CreatorAnalyticsWindow {
	const value = Array.isArray(raw) ? raw[0] : raw;
	return typeof value === "string" && KNOWN_WINDOWS.has(value)
		? (value as CreatorAnalyticsWindow)
		: DEFAULT_CREATOR_ANALYTICS_WINDOW;
}

/** Merge semantics of `setParams`: the default window is cleared by explicit `undefined` (same rule as the discovery screen). */
export const analyticsWindowParams = (
	window: CreatorAnalyticsWindow,
): { window: string | undefined } => ({
	window: window === DEFAULT_CREATOR_ANALYTICS_WINDOW ? undefined : window,
});
