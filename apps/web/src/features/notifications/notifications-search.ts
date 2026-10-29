import { z } from "zod";

/**
 * The notifications tab lives in the address, following the same rule as the create workspace.
 *
 * Why it exists now: the tab used to be internal `Tabs` state, which was adequate while nothing
 * needed to point at a tab. The bell popover created that need. Its updates tab has a footer link,
 * `See all updates`, that must land on this tab. Without an address, the link falls back to `General`, and
 * the user has to find what they were looking at again.
 *
 * As an address, refresh, back navigation, and link sharing come for free. `useState` loses all
 * three. `localStorage` would make Alice's last-viewed tab Bob's default on a shared browser.
 *
 * No separate route. The rule is `?tab=updates`, not `/notifications/updates`. The two tabs are not
 * axes within the inbox but two surfaces one screen composes. A route would give the tab its own
 * loader, cache, and empty state, and updates cannot have a loader because they are repo content.
 *
 * Zod validates the input because this is the router boundary. The address bar is user-editable, so
 * incoming values need a checkpoint.
 */

/**
 * There are exactly two tabs. A value in the vocabulary makes the screen start drawing it, even as
 * a tab, and users read it as an upcoming feature. Per-kind tabs (such as `mentions` or `system`)
 * and read/unread filters are not part of this slice. The inside of the inbox stays one
 * chronological stream.
 */
export const NOTIFICATIONS_TABS = ["general", "updates"] as const;
export type NotificationsTab = (typeof NOTIFICATIONS_TABS)[number];

/**
 * The default tab is `General`.
 *
 * A new announcement does not change this value. If it did, the dot would become an interception,
 * for the same reason this slice removed the startup popup. The inbox is also what people arriving
 * at this address usually want.
 */
export const DEFAULT_NOTIFICATIONS_TAB: NotificationsTab = "general";

export interface NotificationsSearch {
	tab?: NotificationsTab;
}

/**
 * Unknown values fall back to the default tab (`.catch`).
 *
 * If one edited character turned the inbox into an error screen, the user would read it as their
 * notifications having disappeared, though the server still has them.
 */
const RawNotificationsSearch = z.object({
	tab: z.enum(NOTIFICATIONS_TABS).optional().catch(undefined),
});

export function validateNotificationsSearch(input: Record<string, unknown>) {
	const parsed = RawNotificationsSearch.parse(input);
	const search: NotificationsSearch = {};
	/*
	 * Defaults are left out of the address. Keeping `?tab=general` would give the same screen two
	 * addresses, which become separate entries in back-navigation history.
	 */
	if (parsed.tab && parsed.tab !== DEFAULT_NOTIFICATIONS_TAB)
		search.tab = parsed.tab;
	return search;
}

/**
 * The tab the address asks for. An omitted value is the default, and an unknown value also falls
 * back to the default.
 *
 * The address was validated above, yet this function checks again because of how TanStack Router
 * merges search. The search the screen receives is the merge of all matched routes, and a parent
 * route that does not validate passes the raw address value through. So `?tab=garbage` can arrive
 * here as `garbage` even though this route dropped it.
 *
 * If that value reached `Tabs`' `value`, no tab would be selected: both tabs off, the area below
 * empty, and no error. The user would again read their notifications as gone. Validation decides
 * what stays in the address. This function decides what the screen draws, and its answer must exist
 * for every input, so it is total. The types alone are not trusted.
 */
export const notificationsTabFromSearch = (
	search: NotificationsSearch,
): NotificationsTab =>
	NOTIFICATIONS_TABS.find((tab) => tab === search.tab) ??
	DEFAULT_NOTIFICATIONS_TAB;

/**
 * The address for a tab. Links and navigation both go through this function, so the
 * default-omitting serialization rule is not rewritten at each call site. If one place wrote
 * `?tab=general`, only that link would have a different address.
 */
export const notificationsSearchForTab = (
	tab: NotificationsTab,
): NotificationsSearch => (tab === DEFAULT_NOTIFICATIONS_TAB ? {} : { tab });
