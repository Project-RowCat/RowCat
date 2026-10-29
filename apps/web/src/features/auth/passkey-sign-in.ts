import { translator } from "#/lib/i18n/current.ts";
import type { AuthFailure } from "./auth-error.ts";
import { isTransportFailure } from "./auth-error.ts";

/**
 * Maps a passkey sign-in failure to a sentence.
 *
 * ## Cancelling is not a failure
 *
 * If the user dismisses the WebAuthn prompt, an error still comes back. Saying "sign-in failed"
 * there makes the person doubt their own account, and they then reset the password. That is why the
 * default sentence is neutral.
 *
 * ## The reason is not split out
 *
 * Distinguishing "no passkey registered" from "signature mismatch" would make this button a lookup
 * that answers whether this device has a passkey for the site. That is the same axis as the sign-in
 * form not becoming a member-directory lookup.
 *
 * ## The next step is stated instead
 *
 * What a person without a working passkey needs is another route, not the reason, and that route is
 * already on the same screen (password and social methods). The sentence points there. It
 * deliberately names no provider: a named provider would make this sentence go stale, silently,
 * when a method is added.
 */
export function passkeySignInErrorMessage(error: AuthFailure): string {
	if (isTransportFailure(error)) return translator("auth")("passkey.transport");
	if (error.status === 429) return translator("auth")("rateLimited");
	return translator("auth")("passkey.failed");
}
