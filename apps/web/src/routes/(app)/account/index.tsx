import { APP_NAME } from "@rowcat/domain";
import { accountQueryOptions, viewerQueryOptions } from "@rowcat/query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { AccountPage } from "#/features/account/account-page.tsx";
import { AccountShell } from "#/features/account/account-shell.tsx";
import { AccountSkeleton } from "#/features/account/account-skeleton.tsx";
import { getRowCatClient } from "#/lib/api.ts";
import { translator } from "#/lib/i18n/current.ts";

export const Route = createFileRoute("/(app)/account/")({
	/**
	 * Only logged-in users get in. This is the same guard as creation.
	 *
	 * Membership state (approved) is not checked. Suspended or blocked accounts must still read their
	 * own account information, turn off the adult display, and log out. Adding a check equivalent to
	 * requireActiveViewer here would make the privacy screen a dead end for restricted users (a real
	 * defect in the legacy app). What is locked is decided by each action's own gate.
	 *
	 * The check runs in beforeLoad, not in the component, to avoid flicker. A component check would
	 * draw an empty account screen once before it disappeared, and on the server that wrong first
	 * screen would be frozen into the HTML sent out. The lookup uses the same viewerQueryOptions as
	 * the root loader, so /me is not requested twice.
	 */
	beforeLoad: async ({ context, location }) => {
		const viewer = await context.queryClient.ensureQueryData(
			viewerQueryOptions(getRowCatClient()),
		);
		if (!viewer)
			throw redirect({
				to: "/login",
				// Returns here after login. Validation is done again by the login route.
				search: { redirect: location.href },
			});
	},

	/**
	 * Account info is loaded only after authentication is confirmed, which is why this is a loader and
	 * not beforeLoad.
	 *
	 * During SSR, this request goes out with a request-scoped client that carries the Cookie of the
	 * incoming request (getRowCatClient()). A client that holds a cookie at module scope would let two
	 * concurrent requests overwrite the same slot. Alice's SSR HTML could then contain Bob's email.
	 *
	 * Swallowing the error is intentional. This query fills only one section of the screen (security).
	 * If it threw, someone who came to fix a nickname or to log out would get an error screen. Because
	 * no value is written to the cache, the query stays in error and the browser retries. Meanwhile
	 * that section reports the failure in its own place.
	 */
	loader: async ({ context }) => {
		try {
			await context.queryClient.ensureQueryData(
				accountQueryOptions(getRowCatClient()),
			);
		} catch (reason) {
			console.warn("[account] could not prefetch the account details", reason);
		}
	},

	/**
	 * Fixed title. Do not put the nickname or email in the document title. The title stays in browser
	 * history and the tab list, and others can see it when the screen is shared.
	 */
	head: () => ({
		meta: [
			{ title: translator("shell")("titles.account", { app: APP_NAME }) },
			// This screen contains only private information, so there is no reason to index it.
			{ name: "robots", content: "noindex" },
		],
	}),
	component: AccountPage,

	/**
	 * This screen waits for what the server knows, so it has a placeholder.
	 *
	 * This is where it differs from chat and creation. There, the thing being waited on is this
	 * device's data, which the router knows nothing about. Here, the account needs the viewer from
	 * beforeLoad and the account information from the loader before it can draw. That wait belongs to
	 * the router, so the display is handled by the router too.
	 *
	 * When the placeholder appears is set by the router's shared policy (router.tsx). On revisits
	 * where the cache is already filled, the loader finishes in the same tick, so this screen is never
	 * drawn.
	 */
	pendingComponent: () => (
		<AccountShell>
			<AccountSkeleton />
		</AccountShell>
	),
});
