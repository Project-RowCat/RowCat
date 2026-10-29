import { passkeyClient } from "@better-auth/passkey/client";
import { twoFactorClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";
import { API_BASE_URL } from "./api.ts";

/**
 * The authentication client performs login and logout. It is not a source of screen state.
 *
 * Product identity (nickname, member status, adult gate) comes from `/v2/me`, and authorization
 * keys on that member id. The Better Auth user id identifies the sign-in account, so if product
 * code keyed on it, changing the sign-in method would change the authorization model. This file
 * therefore exposes only what to do. Who the user is comes from `viewerQueryOptions` in
 * @rowcat/query.
 *
 * OAuth URLs, state, and PKCE are not built by hand. Hand-written versions reliably contain a bug,
 * and that bug is an account-takeover path. The server already mounts the Better Auth handler, so
 * the client uses the same implementation.
 *
 * Email and password call `authClient.signIn.email` and `authClient.signUp.email` directly from
 * features/auth. No wrapper exists because there is no policy to wrap. The return-destination check
 * below is shared by every sign-in method, so it lives here.
 *
 * Passkeys follow the same rule. The WebAuthn ceremony (`navigator.credentials`) is not written by
 * hand; the plugin client exchanges challenges with the server. The only addition here is the
 * support check, which describes this browser rather than the protocol.
 */
export const authClient = createAuthClient({
	// Must match the server's mount point (apps/api: `${publicApiUrl}/auth`). The origin is decided
	// once, in lib/api.ts. Re-reading the environment variable here would split it.
	baseURL: `${API_BASE_URL}/auth`,
	/**
	 * Passkey client. It must pair with the server plugin. If only one side has it, the operation
	 * fails at runtime with a 404 while the types still pass.
	 */
	/**
	 * Two-factor client. It passes neither `onTwoFactorRedirect` nor `twoFactorPage`.
	 *
	 * Those options let the library move the page itself when a challenge appears. The login screen
	 * reads the response directly (`isTwoFactorRedirect`) and switches to the challenge input in
	 * place. Leaving navigation to the library would lose `?redirect=` and the in-progress state in
	 * between.
	 */
	plugins: [passkeyClient(), twoFactorClient()],
});

/**
 * Whether this browser can use passkeys. This is a fact about the environment, not the protocol.
 *
 * On the server it is always false: there is no `window` or `PublicKeyCredential`, and assuming
 * they exist would crash SSR. The screen therefore reads it inside an effect, once. Reading it
 * during render would make the server HTML and the hydrated result disagree.
 *
 * `navigator.credentials` is checked too because of insecure contexts, such as a staging site
 * opened over http. There, `PublicKeyCredential` can be defined while the ceremony never starts.
 */
export function isPasskeySupported(): boolean {
	if (typeof window === "undefined") return false;
	return (
		typeof window.PublicKeyCredential === "function" &&
		typeof navigator !== "undefined" &&
		typeof navigator.credentials?.create === "function"
	);
}

/**
 * Signs in with a passkey. The email is not asked first: the installed API does not require it
 * (discoverable credentials), and asking would turn the form into a lookup that reveals whether an
 * email has a passkey.
 *
 * The return destination is intentionally not handled here, and this is where it differs from
 * Google. OAuth leaves the browser and comes back, so it needs a callback URL. A passkey completes
 * inside this tab. On success a session exists, and the caller navigates the same way as for email
 * sign-in and sign-up (`handleAuthenticated`). There is no per-method post-processing.
 */
export function signInWithPasskey() {
	return authClient.signIn.passkey();
}

/**
 * Registers a passkey for the account that is already signed in. This is not a sign-in.
 *
 * `createSession` is deliberately not passed (its default is false). The user is already logged in,
 * so no new session is needed. Creating one would add a row to the session list on a single click,
 * and the user would see a login they never performed.
 *
 * The user chooses the label. The name is not derived from authenticator details reported by the
 * browser, for the same reason the active-session list does not parse User-Agent.
 */
export function registerPasskey(name: string) {
	return authClient.passkey.addPasskey({ name });
}

/** Default destination after authentication, used when the page the user came from is unknown. */
export const DEFAULT_REDIRECT_PATH = "/";

/**
 * Decides whether a value may be used as the post-authentication return address.
 *
 * The value comes from links made by others (`/login?redirect=...`). Trusting it would create an
 * open redirect, and in an OAuth callback it would become a phishing path. The server's
 * `trustedOrigins` is the final defense, but an untrusted value should not be passed in at all.
 *
 * Origins are never compared. The check accepts only paths inside this app, meaning values that
 * start with `/`. No host can be expressed that way, so there is no allowlist to maintain and no
 * omitted domain can become a hole.
 *
 * Forms rejected:
 * - A leading `//`, or `/` followed by a backslash and a host. Browsers read these as
 *   protocol-relative URLs and leave the site. Checking the first two characters catches them, and
 *   backslashes are rejected as well.
 * - `https://evil.example` and `javascript:` URLs, which do not start with `/`.
 * - Control characters inside the value. If a parser strips whitespace, the value can change
 *   meaning.
 *
 * The hash is dropped. Browsers never send it to the server, so it means nothing in a callback URL.
 */
function safeRedirectPath(value: unknown): string | undefined {
	if (typeof value !== "string" || !value.startsWith("/")) return undefined;
	if (value.length > 1 && (value[1] === "/" || value[1] === "\\"))
		return undefined;
	// biome-ignore lint/suspicious/noControlCharactersInRegex: blocking characters that confuse the parser is the purpose of this pattern.
	if (/[\u0000-\u001f\u007f\\]/.test(value)) return undefined;
	/**
	 * The shape is safe by this point; what remains is normalization. Parsing against a dummy origin
	 * folds duplicate slashes, `..`, and similar sequences by the same rules the browser uses. Folding
	 * by hand could diverge from the browser's rules someday, and then the check and the actual
	 * navigation would disagree.
	 */
	const url = new URL(value, "http://localhost");
	const normalized = `${url.pathname}${url.search}`;
	// A value whose `..` tried to escape the origin folds back to `/`, which is simply the default
	// destination. A result that still starts with `//` is rejected.
	return normalized.startsWith("//") ? undefined : normalized;
}

/** The login screen's own path. It can never be a return destination (see `redirectTargetFrom`). */
const LOGIN_PATH = "/login";

/**
 * The actual post-authentication destination. This is the app's only decision point.
 *
 * Every caller uses it: the route's validateSearch, the beforeLoad that bounces signed-in users,
 * form success handling, and the Google callback. Filtering once at the boundary and trusting the
 * value below is not safe. In this version of TanStack Router, `beforeLoad` receives search
 * parameters before validation, so the single trusted place would have been an open redirect.
 *
 * The rule lives in one function, but the check runs wherever the value is used. It is idempotent,
 * so repeated calls return the same result, and a new caller never has to decide whether it needs
 * filtering.
 *
 * Returns `undefined` for:
 * - Unsafe forms (external URLs, protocol-relative URLs, control characters). `safeRedirectPath`
 *   decides this.
 * - The default destination `/`, which does not need to stay in the address.
 * - The login screen itself. Otherwise login success, then the login screen, then an
 *   already-authenticated redirect back to login would loop forever.
 */
export function redirectTargetFrom(value: unknown): string | undefined {
	const path = safeRedirectPath(value);
	if (!path || path === DEFAULT_REDIRECT_PATH) return undefined;
	if (path === LOGIN_PATH || path.startsWith(`${LOGIN_PATH}?`))
		return undefined;
	return path;
}

/**
 * Providers this file can start.
 *
 * `SOCIAL_PROVIDERS` in `features/auth/social-sign-in.ts` is the authority for the screen; this
 * file is only transport. The type is not imported because of dependency direction: `lib` is the
 * base layer feature code depends on, and if it imported `features`, the dependency would invert.
 *
 * The two lists are kept in sync at the call site instead. The login screen selects start functions
 * through `Record<SocialProvider, ...>`, so a value added to only one list breaks compilation.
 */
type SocialSignInProvider = "google" | "apple" | "kakao";

/**
 * Social sign-in. Only the provider name differs; everything else is identical.
 *
 * It is one function rather than one per provider because the only policies inside are destination
 * checking and origin assembly, and neither depends on the provider. Copies would eventually drop
 * `redirectTargetFrom` on one path, and only users of that method would get the open redirect.
 *
 * The callback must be an absolute URL, because the browser returns through the OAuth provider.
 * This app's origin is appended here, after the path is validated. If callers supplied the origin,
 * that argument would be the hole.
 *
 * Failure needs a destination too. Without `errorCallbackURL`, Better Auth sends failures to its
 * own English error page (`{API}/v2/auth/error` when `onAPIError.errorURL` is unset). That page
 * sits outside this app, has no retry button, and offers no other sign-in method. Kakao made this a
 * normal path: email is optional consent there, and declining creates no account
 * (`email_not_found`). Unchecking one box on the consent screen reaches it.
 *
 * So failures return to the login screen, where sign-in started and where the other methods already
 * exist. The wiring is not split per provider. All three behave the same, and Google and Apple had
 * been failing silently for the same reason; splitting it would hide from this file which method
 * gets an explanation.
 *
 * The error code carried back is only a claim. This code changes no state; it selects a message.
 * Whether sign-in actually succeeded is always answered by the server.
 */
function startSocialSignIn(
	provider: SocialSignInProvider,
	redirectPath: string,
) {
	const path = redirectTargetFrom(redirectPath) ?? DEFAULT_REDIRECT_PATH;
	// Never called during server rendering (it is a click handler). Still, when there is no origin,
	// the relative path is not passed; the field is omitted so Better Auth falls back to its own
	// default.
	const origin = typeof window === "undefined" ? null : window.location.origin;
	return authClient.signIn.social({
		provider,
		callbackURL: origin === null ? undefined : `${origin}${path}`,
		/**
		 * The return place is **not lost**. A user whose attempt failed and who signs in another way must
		 * reach the original destination, so the validated path travels unchanged. The route runs it
		 * through `redirectTargetFrom` again when it receives it.
		 *
		 * The library appends `&error=<code>` to this URL, so existing query parameters remain.
		 */
		errorCallbackURL:
			origin === null
				? undefined
				: `${origin}${LOGIN_PATH}?${new URLSearchParams({
						/**
						 * Our own marker. Judging by `error` alone would break the day another feature uses the same
						 * name, and the login screen would show someone else's failure. The account screen's
						 * connection round trip keeps its own `connect=error` for the same reason.
						 */
						authError: "1",
						/**
						 * The sign-in method is carried on the failure path too. Nothing else remembers which method
						 * was chosen while the browser is away, and recovering it would need storage. The returned
						 * value is validated before use.
						 */
						provider,
						...(path === DEFAULT_REDIRECT_PATH ? {} : { redirect: path }),
					}).toString()}`,
	});
}

export function signInWithGoogle(redirectPath: string) {
	return startSocialSignIn("google", redirectPath);
}

/**
 * The call site sees no difference at all, which is the point. Only Apple's callback returns as a
 * cross-site POST (`response_mode=form_post`), but that round trip is handled by the server and
 * Better Auth. What this function does is identical to Google's. Provider-specific branches in
 * browser code would soon spread into callback handling and error messages.
 *
 * The `name` scope is not adjusted here. The scope list is provider configuration set by the server
 * (`apps/api/src/auth/index.ts`). If the client supplied scopes, one deployment would show
 * different consent screens depending on where a request came from.
 */
export function signInWithApple(redirectPath: string) {
	return startSocialSignIn("apple", redirectPath);
}

/**
 * Same as the two above: no visible difference at the call site.
 *
 * Kakao's consent items are product configuration. Whether email is required or optional consent is
 * decided in the Kakao console and app review. Passing scopes from here is especially risky: one
 * deployment could show different consent screens per request origin, and only one of them would
 * receive an email.
 */
export function signInWithKakao(redirectPath: string) {
	return startSocialSignIn("kakao", redirectPath);
}
