import { APP_NAME } from "@rowcat/domain";
import { createFileRoute } from "@tanstack/react-router";
import { resetTokenFrom } from "#/features/auth/password-reset.ts";
import { ResetPasswordPage } from "#/features/auth/reset-password-page.tsx";
import { redirectTargetFrom } from "#/lib/auth.ts";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Public screen reached from the password-reset email. One address covers three states, and the
 * address decides which one:
 * - `/reset-password`: enter an address to get a reset email
 * - `/reset-password?token=…`: the email link brought the user here; set a new password
 * - `/reset-password?error=INVALID_TOKEN`: the link expired or was used; request another
 *
 * It is not split into forgot-password and reset-password routes. When the link dies, the fix is to
 * request a new email, and the expired state on the same address lets the user do that in place.
 *
 * It sits outside the `(app)` group, for the same reason as login: visitors are mostly not logged
 * in, and the entry gate must not stand in front of it. Logged-in users are not kicked out either.
 * Being logged in on another device while forgetting the password is common, and a reset ends those
 * sessions on the server (revokeSessionsOnPasswordReset).
 */

export interface ResetPasswordSearch {
	/**
	 * Token from the email link. Only values matching the expected shape are carried (see
	 * resetTokenFrom).
	 */
	token?: string;
	/** The library's error=INVALID_TOKEN folded into a boolean. The raw value is not carried. */
	expired?: true;
	/** Internal app path to continue to after signing in following the reset. */
	redirect?: string;
}

/**
 * Silently drops invalid values instead of throwing. If a hand-edited character turned this screen
 * into an error, a user who lost their password would have no next step.
 *
 * The error string is not carried as-is. Once the screen had a place to draw that value, it would
 * render text typed into the address bar (the same reasoning as `authError` on /login).
 */
function validateResetSearch(
	search: Record<string, unknown>,
): ResetPasswordSearch {
	const result: ResetPasswordSearch = {};
	const token = resetTokenFrom(search.token);
	if (token) result.token = token;
	else if (search.error === "INVALID_TOKEN") result.expired = true;
	const redirect = redirectTargetFrom(search.redirect);
	if (redirect) result.redirect = redirect;
	return result;
}

export const Route = createFileRoute("/reset-password")({
	validateSearch: validateResetSearch,
	head: () => ({
		meta: [
			{ title: translator("shell")("titles.resetPassword", { app: APP_NAME }) },
			// The address can contain a one-time token. A crawler that stored it would itself leak the
			// token, so the page is kept out of indexes and link following.
			{ name: "robots", content: "noindex, nofollow" },
			/**
			 * Sends only the origin to outside sites, never the path or query. The token stays in the
			 * address for a frame before it is stripped, and a cross-origin request in that window could
			 * carry it in Referer. This screen only calls our own API, so sending the origin loses nothing.
			 */
			{ name: "referrer", content: "strict-origin-when-cross-origin" },
		],
	}),
	component: ResetPasswordPage,
});
