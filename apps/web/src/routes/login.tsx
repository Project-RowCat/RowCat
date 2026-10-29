import { APP_NAME } from "@rowcat/domain";
import { runtimeConfigQueryOptions, viewerQueryOptions } from "@rowcat/query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { AuthPage } from "#/features/auth/auth-page.tsx";
import {
	type SocialCallbackErrorCode,
	type SocialProvider,
	socialCallbackErrorCodeFrom,
	socialProviderFrom,
} from "#/features/auth/social-sign-in.ts";
import { getRowCatClient } from "#/lib/api.ts";
import { DEFAULT_REDIRECT_PATH, redirectTargetFrom } from "#/lib/auth.ts";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Login: email/password and Google share one screen.
 *
 * It is not split into /login and /register. They are one screen with `?mode=signup` because most
 * of it is shared (the form, the Google button, the return address). With two routes, each would
 * have to carry `redirect`, and one would eventually drop it, sending users somewhere wrong after
 * login.
 *
 * It sits outside the `(app)` group because it does not use the app header, whose login button
 * would otherwise point at itself.
 */

/**
 * Values carried in the address. Both are optional, so the default `/login` URL gets nothing
 * appended.
 */
export interface AuthSearch {
	mode?: "signup";
	/**
	 * Internal app path to return to after sign-in. It is already validated (see validateAuthSearch).
	 */
	redirect?: string;
	/**
	 * Marks that the user came back from email verification. This is not authority: anyone can type
	 * it, and only the server knows whether the account was verified. No state changes because of it.
	 * Its only effect is drawing one sentence, and a false value costs nothing, since an unverified
	 * account is still blocked at login.
	 */
	verified?: true;
	/**
	 * Marks that the user came back from a password reset, same as `verified`. It only draws one
	 * sentence. A false value costs nothing: the server checks the new password in the form below.
	 */
	reset?: true;
	/**
	 * Marks that a social login came back as a failure from the provider. The three params always
	 * arrive together, and all come from the address. `authError` is a flag we set; `error` is set by
	 * Better Auth (we cannot choose its name); `provider` is the value we sent out, since nothing else
	 * remembers which provider was used.
	 *
	 * None of them is authority. They only pick one sentence, and whether the login succeeded is known
	 * only to the server, so no state changes from them.
	 */
	authError?: true;
	/** Only reasons we named are carried; anything else is dropped (see validateAuthSearch). */
	error?: SocialCallbackErrorCode;
	/** Only providers we recognize are carried. */
	provider?: SocialProvider;
}

/**
 * Maps the address to screen state.
 *
 * `redirect` comes from links other people made, so it is not passed through as-is.
 * redirectTargetFrom (lib/auth.ts) decides what may be a destination, and only values that pass it
 * are carried here.
 *
 * Nothing downstream relies on this check. beforeLoad and the screen call the same function again,
 * because this router version passes unvalidated search params to beforeLoad. Filtering here only
 * keeps junk values out of links the screen builds (mode switches); it does not guarantee safety.
 *
 * Invalid values are dropped silently instead of throwing: a hand-edited character turning the
 * login screen into an error would look like a broken app.
 */
function validateAuthSearch(search: Record<string, unknown>): AuthSearch {
	const result: AuthSearch = {};
	if (search.mode === "signup") result.mode = "signup";

	const redirect = redirectTargetFrom(search.redirect);
	if (redirect) result.redirect = redirect;

	/**
	 * Folds the value to a boolean. Carrying the raw string would give the screen a place to render
	 * text typed into the address bar.
	 */
	if (search.verified === "1" || search.verified === true)
		result.verified = true;

	if (search.reset === "1" || search.reset === true) result.reset = true;

	/**
	 * Social-callback failures also use only a fixed vocabulary, for the same reason as folding
	 * `verified`: a raw `error` string would be rendered from the address bar. Only named reasons and
	 * known providers pass. Anything else is dropped silently, and the screen shows a neutral default
	 * sentence.
	 */
	if (search.authError === "1" || search.authError === true) {
		result.authError = true;
		const code = socialCallbackErrorCodeFrom(search.error);
		if (code) result.error = code;
		const provider = socialProviderFrom(search.provider);
		if (provider) result.provider = provider;
	}

	return result;
}

export const Route = createFileRoute("/login")({
	validateSearch: validateAuthSearch,
	/**
	 * Hides the form from users who are already logged in.
	 *
	 * This is decided in beforeLoad rather than in the component. A component check would flash the
	 * form and bake the wrong first screen into SSR HTML. Throwing here lets the server render the
	 * destination directly.
	 *
	 * The lookup is the same viewerQueryOptions the root loader uses, so Query merges the requests and
	 * /me is not called twice.
	 */
	beforeLoad: async ({ context, search }) => {
		const viewer = await context.queryClient.ensureQueryData(
			viewerQueryOptions(getRowCatClient()),
		);
		if (viewer)
			throw redirect({
				/**
				 * Validates again here. This router version passes raw search params to beforeLoad, skipping
				 * validateAuthSearch, so the value goes through redirectTargetFrom again. Trusting an
				 * already-filtered value would make this one line an open redirect:
				 * ?redirect=https://evil.example would go out as the Location header.
				 */
				href: redirectTargetFrom(search.redirect) ?? DEFAULT_REDIRECT_PATH,
				// Replaces the login entry in history: it is not a place Back should return to.
				replace: true,
			});
	},
	/**
	 * Fetches the public runtime config ahead of render, because whether the `Forgot your password?` link
	 * appears depends on it (`passwordReset`).
	 *
	 * Fetching on the server puts the correct markup in the first HTML. Fetching in the screen would
	 * make the link appear a beat late.
	 *
	 * Failures are swallowed. A missing value must not turn the login screen into an error, and
	 * without it the link folds to hidden. That is safer than showing a reset link when reset is
	 * closed.
	 */
	loader: async ({ context }) => {
		await context.queryClient
			.ensureQueryData(runtimeConfigQueryOptions(getRowCatClient()))
			.catch(() => undefined);
	},
	head: () => ({
		meta: [
			{ title: translator("shell")("titles.login", { app: APP_NAME }) },
			// The login screen has no reason to appear in search results.
			{ name: "robots", content: "noindex" },
		],
	}),
	component: AuthPage,
});
