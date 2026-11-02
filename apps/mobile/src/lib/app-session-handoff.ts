import { sha256 } from "@noble/hashes/sha2.js";
import { randomBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import {
	APP_SESSION_HANDOFF_BINDING_PARAM,
	APP_SESSION_HANDOFF_CODE_PARAM,
} from "@rowcat/contracts";

/**
 * The pure half of the browser sign-in's last hop: the secret the app keeps, the binding it sends, and
 * reading the one-time code off the redirect (`@rowcat/contracts`' `app-session-handoff.ts` has the
 * flow; the server half is `apps/api/src/auth/app-session-handoff.ts`).
 *
 * **The verifier never leaves this process except in the redeem request's body.** It is not stored —
 * not in SecureStore, not in state that outlives the round trip — because its whole value is that the
 * `rowcat://` URL, which another installed app may receive, cannot be turned into a session without it.
 * A verifier that survives the round trip is a second thing to steal.
 *
 * This file imports nothing from React Native (the browser half, `auth-browser.ts`, does), so the
 * derivations are checked by value in tests. The binding must be byte-for-byte the server's
 * `handoffBindingOf`; `app-session-handoff.test.ts` pins one vector on both sides.
 */

const BASE64URL =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/** Unpadded base64url. Hermes has `btoa`, but this keeps the derivation free of any global. */
export function base64url(bytes: Uint8Array): string {
	let out = "";
	let i = 0;
	for (; i + 2 < bytes.length; i += 3) {
		const n =
			((bytes[i] ?? 0) << 16) |
			((bytes[i + 1] ?? 0) << 8) |
			(bytes[i + 2] ?? 0);
		out +=
			BASE64URL[(n >> 18) & 63] +
			BASE64URL[(n >> 12) & 63] +
			BASE64URL[(n >> 6) & 63] +
			BASE64URL[n & 63];
	}
	const rest = bytes.length - i;
	if (rest === 1) {
		const n = (bytes[i] ?? 0) << 16;
		out += BASE64URL[(n >> 18) & 63] + BASE64URL[(n >> 12) & 63];
	} else if (rest === 2) {
		const n = ((bytes[i] ?? 0) << 16) | ((bytes[i + 1] ?? 0) << 8);
		out +=
			BASE64URL[(n >> 18) & 63] +
			BASE64URL[(n >> 12) & 63] +
			BASE64URL[(n >> 6) & 63];
	}
	return out;
}

/** 32 bytes from the platform CSPRNG (`secure-random.ts` installs it before anything else loads). */
export const newHandoffVerifier = (
	random: (length: number) => Uint8Array = randomBytes,
): string => base64url(random(32));

export const handoffBindingOf = (verifier: string): string =>
	base64url(sha256(utf8ToBytes(verifier)));

/** The callback the server will redirect to, carrying the binding. */
export function withHandoffBinding(
	callbackURL: string,
	binding: string,
): string {
	const url = new URL(callbackURL);
	url.searchParams.set(APP_SESSION_HANDOFF_BINDING_PARAM, binding);
	return url.toString();
}

/** The one-time code on the redirect the browser session returned, or `null` (no session was created). */
export function handoffCodeFrom(redirect: string): string | null {
	try {
		return new URL(redirect).searchParams.get(APP_SESSION_HANDOFF_CODE_PARAM);
	} catch {
		return null;
	}
}
