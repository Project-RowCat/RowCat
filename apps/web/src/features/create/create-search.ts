import {
	CREATOR_ANALYTICS_WINDOWS,
	type CreatorAnalyticsWindow,
	DEFAULT_CREATOR_ANALYTICS_WINDOW,
} from "@rowcat/domain";
import { z } from "zod";

/**
 * Workspace navigation state lives in the URL, as the gallery does. In React state, refresh, back
 * navigation, and link sharing would each need separate work, and returning from a work detail
 * would show the draft list instead of the tab the user was on. localStorage is not used either: on
 * a shared browser, the last tab one user viewed would become the next user's default, and it
 * cannot be shared by link. Zod is used because the router is the trust boundary. The address is
 * input the user can edit by hand, so there must be one place that decides whether incoming values
 * are trusted.
 */

/**
 * `analytics` was added as the third tab and `comments` (`Received comments`) as the fourth. Both followed the
 * same rule: once a value is in the vocabulary, the screen starts drawing it as an inactive tab,
 * and users read it as a feature that is coming soon. So values are added one line at a time,
 * together with the screen that draws them. `settings` still has no slot. The `Story settings` screen is not
 * part of this workspace, and a value in the vocabulary alone would become a tab that opens
 * nothing.
 */
export const CREATE_VIEWS = [
	"drafts",
	"published",
	"analytics",
	"comments",
] as const;
export type CreateView = (typeof CREATE_VIEWS)[number];

/**
 * The default tab is drafts, and it stays drafts with four tabs. People entering the workspace
 * mostly want to resume a manuscript, and this tab renders without a server. A default of `Published`
 * or `Analytics` would show an error first to anyone offline. Analytics is the most server-bound tab (a
 * single aggregate query), so as the default the whole workspace would look dead offline.
 */
export const DEFAULT_CREATE_VIEW: CreateView = "drafts";

export interface CreateSearch {
	/**
	 * When the tab is the default (`drafts`), it is not written to the address. This is the same
	 * serialization rule as the gallery.
	 */
	view?: CreateView;
	/**
	 * The analytics period window is in the address for the same reason as the tab: refresh, back
	 * navigation, and links open the same window. Outside the analytics tab it has no meaning, so it
	 * is folded out of the address (no address is left with a bare `?window=`).
	 */
	window?: CreatorAnalyticsWindow;
}

/**
 * A wrong value in one parameter must not break the whole screen (`.catch`). If one wrong character
 * in a hand-edited URL turned the workspace into an error screen, the user would read it as their
 * drafts being gone, even though the drafts are still on the device.
 */
const RawCreateSearch = z.object({
	view: z.enum(CREATE_VIEWS).optional().catch(undefined),
	window: z.enum(CREATOR_ANALYTICS_WINDOWS).optional().catch(undefined),
});

export function validateCreateSearch(input: Record<string, unknown>) {
	const parsed = RawCreateSearch.parse(input);
	const search: CreateSearch = {};
	// The default is left out of the address. Keeping `?view=drafts` would give the same screen two
	// addresses, which become separate back-history entries.
	if (parsed.view && parsed.view !== DEFAULT_CREATE_VIEW)
		search.view = parsed.view;
	if (
		parsed.view === "analytics" &&
		parsed.window &&
		parsed.window !== DEFAULT_CREATOR_ANALYTICS_WINDOW
	)
		search.window = parsed.window;
	return search;
}

export const analyticsWindowFromSearch = (
	search: CreateSearch,
): CreatorAnalyticsWindow => search.window ?? DEFAULT_CREATOR_ANALYTICS_WINDOW;

export const createSearchForAnalyticsWindow = (
	window: CreatorAnalyticsWindow,
): CreateSearch =>
	window === DEFAULT_CREATOR_ANALYTICS_WINDOW
		? { view: "analytics" }
		: { view: "analytics", window };

export const createViewFromSearch = (search: CreateSearch): CreateView =>
	search.view ?? DEFAULT_CREATE_VIEW;

/**
 * The search for the address that leads to this tab. Links pass through this function so the
 * serialization rule (omit the default) is not rewritten for each screen. If only one link carried
 * `?view=drafts`, that link alone would produce a different address.
 */
export const createSearchForView = (view: CreateView): CreateSearch =>
	view === DEFAULT_CREATE_VIEW ? {} : { view };

/**
 * The address a link in the workspace navigation row points to. If the user is already on that tab,
 * it is the current address, unchanged. Row links are active-matched with `activeOptions={{ exact:
 * true, includeSearch: true }}`. The default `{}` is a subset of every address, so two tabs would
 * light up together. The analytics tab is the only one with an extra parameter in its address. From
 * `?view=analytics&window=week`, a link to `{ view: "analytics" }` is not an exact match, so that
 * tab loses `aria-current`, and screen readers hear a navigation row with no active tab. The
 * underline still shows, so sighted users would not notice the defect. So instead of loosening the
 * match, the link carries the current period. Moving to analytics from another tab carries no
 * period, because the period is an axis of the analytics tab and is folded out of the address when
 * the user leaves it (`validateCreateSearch`).
 */
export function createSearchForNavigation(
	target: CreateView,
	current: CreateSearch,
): CreateSearch {
	if (target === "analytics" && createViewFromSearch(current) === "analytics")
		return createSearchForAnalyticsWindow(analyticsWindowFromSearch(current));
	return createSearchForView(target);
}
