import * as AppleAuthentication from "expo-apple-authentication";
import { type AppleNonce, createAppleNonce } from "./apple-nonce.ts";

/**
 * Apple native sign-in: **the only file that knows `expo-apple-authentication`.**
 *
 * Social sign-in in this app was originally one browser round trip (`@better-auth/expo` opens it
 * with `openAuthSessionAsync`). Apple is split out because the paths really differ:
 *
 * ```text
 * browser round trip   the app opens the sheet → provider → our callback → cookie    the app never touches the token
 * native               the OS draws the sheet → **the id token is handed to the app** → sent to the server
 * ```
 *
 * The native path is better (one Face ID step, no browser). But the app then **holds the
 * credential**, so the place that knows the value is kept to one file. This is the same axis as BYO
 * provider keys sitting behind `local-provider`, and a static scan enforces that uniqueness.
 *
 * ## What this file does not decide
 *
 * It does not decide what to send to the server, what sentence to draw on failure, or whether
 * cancellation is a failure. It returns **one fact that happened** (the union below); the rest is
 * the completion procedure `identity.tsx` already owns. Calling `completeAuthentication` here would
 * make each sign-in method clean up differently, a defect this app has avoided from the start.
 *
 * ## Three branches, and they are different things
 *
 * ```text
 * credential   a token was received        sent to the server
 * cancelled    the person closed the sheet  **nothing happened** — not a failure
 * unavailable  not on this device           falls back to the browser round trip (Android always lands here)
 * ```
 *
 * The three are not folded into one `null`. Folding would show a failure message to someone who
 * cancelled, or make sign-in silently do nothing on Android.
 *
 * **Not branched on `Platform.OS`.** The question is not "is this iOS" but **"can this device use
 * it right now"**, and the two differ: simulators, signed-out iCloud and managed devices are all
 * iOS yet unusable. The library answers that question with a function.
 */

export type AppleNativeAttempt =
	| { status: "credential"; token: string; nonce: string }
	| { status: "cancelled" }
	| { status: "unavailable" };

/** The code thrown on cancellation. The library documents this value. */
const CANCELLED = "ERR_REQUEST_CANCELED";

const isCancellation = (error: unknown): boolean =>
	typeof error === "object" &&
	error !== null &&
	(error as { code?: unknown }).code === CANCELLED;

export async function attemptAppleNativeSignIn(
	nonce: AppleNonce = createAppleNonce(),
): Promise<AppleNativeAttempt> {
	/**
	 * On Android this module always answers false, so that platform skips the code below and takes the
	 * browser path in the caller.
	 */
	if (!(await AppleAuthentication.isAvailableAsync()))
		return { status: "unavailable" };

	try {
		const credential = await AppleAuthentication.signInAsync({
			/**
			 * Name and email arrive **only the first time**. We request them anyway because the server does
			 * not create an account without an email (it does not fabricate a synthetic address); from the
			 * second sign-in the claims in the id token take their place.
			 */
			requestedScopes: [
				AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
				AppleAuthentication.AppleAuthenticationScope.EMAIL,
			],
			/** The hash goes to Apple. The raw value stays with the server (`apple-nonce.ts`). */
			nonce: nonce.hashed,
		});

		/**
		 * No token is **not success.** The type is `string | null`, so passing it on would make the
		 * server try verification with an empty value, and the failure would read as "Apple rejected it".
		 * Nothing has happened yet, so it falls into the same branch as cancellation.
		 */
		if (!credential.identityToken) return { status: "cancelled" };

		return {
			status: "credential",
			token: credential.identityToken,
			nonce: nonce.raw,
		};
	} catch (error) {
		if (isCancellation(error)) return { status: "cancelled" };
		throw error;
	}
}
