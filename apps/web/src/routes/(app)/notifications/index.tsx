import { APP_NAME } from "@rowcat/domain";
import { viewerQueryOptions } from "@rowcat/query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { NotificationsPage } from "#/features/notifications/notifications-page.tsx";
import { validateNotificationsSearch } from "#/features/notifications/notifications-search.ts";
import { getRowCatClient } from "#/lib/api.ts";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Inbox screen at `/notifications`. The beforeLoad guard that sends logged-out viewers to login is
 * not authorization. It only avoids a flash of an empty inbox and a wrong first render baked into
 * the SSR HTML.
 *
 * The real rejection is the 401 that every query on this screen gets from requireViewer. The list
 * stays empty even if this guard is removed.
 *
 * It is not gated by requireActiveViewer. Suspended or blocked members must still read why they
 * were sanctioned and how their appeal was handled.
 *
 * The screen is not in the sidebar. It activates the header utility keyed as notifications, not a
 * navigation section.
 *
 * `?tab=updates` is the only tab axis; there is no second route. The rules live in
 * notifications-search.ts, and unknown values fall back to the default tab.
 */
export const Route = createFileRoute("/(app)/notifications/")({
	validateSearch: validateNotificationsSearch,
	beforeLoad: async ({ context, location }) => {
		const viewer = await context.queryClient.ensureQueryData(
			viewerQueryOptions(getRowCatClient()),
		);
		if (!viewer)
			throw redirect({ to: "/login", search: { redirect: location.href } });
	},

	head: () => ({
		meta: [
			{ title: translator("shell")("titles.notifications", { app: APP_NAME }) },
			/** Private inbox, so it should not be indexed. */
			{ name: "robots", content: "noindex" },
		],
	}),
	component: NotificationsPage,
});
