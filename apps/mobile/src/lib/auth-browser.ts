import { APP_SESSION_HANDOFF_REDEEM_PATH } from "@rowcat/contracts";
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import {
	handoffBindingOf,
	handoffCodeFrom,
	newHandoffVerifier,
	withHandoffBinding,
} from "./app-session-handoff.ts";
import { authBaseUrlFor, authClientFor } from "./auth.ts";
import type { AuthErrorLike } from "./auth-error.ts";
import { activeInstance } from "./instances/device-registry.ts";

/**
 * The browser round trip of sign-in and provider linking — **the one file that opens it**.
 *
 * `@better-auth/expo`'s client used to open this sheet itself and take the session cookie out of the
 * `rowcat://…?cookie=` redirect. The server no longer writes a cookie into any URL (a custom scheme
 * does not say which app receives it), so the round trip is ours now:
 *
 * ```text
 * 1  a fresh verifier; its binding rides the callback URL
 * 2  start the flow with disableRedirect — the library returns the provider URL and opens nothing
 * 3  the same authorization proxy the plugin used (/expo-authorization-proxy plants the state cookie)
 * 4  the sheet returns rowcat://…?rowcat_handoff=<code>, or no code when no session was created
 * 5  redeem code + verifier through the auth client's own fetch — its Expo plugin stores the
 *    Set-Cookie exactly as it stores every other sign-in response
 * ```
 *
 * The sheet waits for **the scheme root**, not the full callback: the server rewrites the query (it
 * strips the binding and adds the code), and on Android the session ends on the first link that
 * *starts with* what we pass, so a prefix carrying the binding would never match.
 *
 * `oauthState` is not forwarded to the proxy: this server keeps OAuth state in the database (the
 * library's default `storeStateStrategy`), so the proxy reads it from the authorization URL. A server
 * that switched to cookie state would need it, and the round trip would fail visibly, not silently.
 */

export type AuthRoundTrip =
	| { status: "error"; error: AuthErrorLike }
	/** The sheet was closed, or the system dismissed it. Nothing happened. */
	| { status: "dismissed" }
	/** The browser came back. `handedOff` says whether a session arrived with it. */
	| { status: "returned"; handedOff: boolean };

interface StartResult {
	data?: { url?: string } | null;
	error?: AuthErrorLike | null;
}

export async function openAuthRoundTrip(input: {
	/** The app path the browser returns to (`/…`), the same value the plugin used to receive. */
	callbackPath: string;
	/** Starts the flow with this callback URL. Must pass `disableRedirect: true`. */
	start: (callbackURL: string) => Promise<StartResult>;
}): Promise<AuthRoundTrip> {
	/**
	 * One server for the whole trip. The proxy, the browser and the redeem all go to the instance that was
	 * active when the press happened; if the active instance moved meanwhile, the code is not redeemed —
	 * it would be spent against a server the screen no longer shows.
	 */
	const active = activeInstance();
	const verifier = newHandoffVerifier();
	const callbackURL = withHandoffBinding(
		Linking.createURL(input.callbackPath),
		handoffBindingOf(verifier),
	);

	const started = await input.start(callbackURL);
	if (started.error) return { status: "error", error: started.error };
	const authorizationURL = started.data?.url;
	if (!authorizationURL) return { status: "error", error: {} };

	// The plugin does the same: an auth session left open on Android blocks the next one.
	try {
		WebBrowser.dismissAuthSession();
	} catch {}

	const proxyURL = `${authBaseUrlFor(active.origin)}/expo-authorization-proxy?${new URLSearchParams({ authorizationURL }).toString()}`;
	const browser = await WebBrowser.openAuthSessionAsync(
		proxyURL,
		Linking.createURL("/"),
	);
	if (browser.type !== "success") return { status: "dismissed" };

	const code = handoffCodeFrom(browser.url);
	if (!code) return { status: "returned", handedOff: false };

	if (activeInstance().origin !== active.origin)
		return { status: "returned", handedOff: false };

	const redeemed = await authClientFor(active).$fetch(
		APP_SESSION_HANDOFF_REDEEM_PATH,
		{
			method: "POST",
			body: { code, verifier },
		},
	);
	if (redeemed.error)
		return { status: "error", error: redeemed.error as AuthErrorLike };
	return { status: "returned", handedOff: true };
}
