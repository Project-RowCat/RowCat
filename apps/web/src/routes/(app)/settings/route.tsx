import { APP_NAME } from "@rowcat/domain";
import { viewerQueryOptions } from "@rowcat/query";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { validateSettingsSearch } from "#/features/settings/settings-return.ts";
import { SettingsShell } from "#/features/settings/settings-shell.tsx";
import { getRowCatClient } from "#/lib/api.ts";
import { translator } from "#/lib/i18n/current.ts";

/**
 * The layout route mounts the navigation list and content width once. Switching categories swaps
 * only the outlet, so the active marker moves between siblings instead of the list remounting.
 *
 * There is no loader or pending component because the values here are not known to the server.
 * Theme lives in localStorage, and generation defaults and provider connections live in per-member
 * IndexedDB.
 *
 * Client-only data stays out of the server HTML. ClientOnly wraps each section rather than the
 * whole screen, so navigation and section titles still render on the server.
 */
export const Route = createFileRoute("/(app)/settings")({
	/**
	 * The search param carries one return target (settings-return.ts). It is validated in the layout
	 * for the same reason as auth: a per-category check would be missed when a screen is added, and
	 * that screen would lose the way back.
	 */
	validateSearch: validateSettingsSearch,
	beforeLoad: async ({ context, location }) => {
		const viewer = await context.queryClient.ensureQueryData(
			viewerQueryOptions(getRowCatClient()),
		);
		if (!viewer)
			throw redirect({
				to: "/login",
				// Login returns here after sign-in. The login route validates the redirect value again.
				search: { redirect: location.href },
			});
	},

	/**
	 * Private screen, so no reason to be indexed. Category routes override the title; only values true
	 * for every category belong here.
	 */
	head: () => ({
		meta: [
			{ title: translator("shell")("titles.settings", { app: APP_NAME }) },
			{ name: "robots", content: "noindex" },
		],
	}),
	component: SettingsLayout,
});

function SettingsLayout() {
	return (
		<SettingsShell>
			<Outlet />
		</SettingsShell>
	);
}
