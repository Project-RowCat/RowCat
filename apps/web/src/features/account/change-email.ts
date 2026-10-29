import { z } from "zod";
import type { AuthFailure } from "#/features/auth/auth-error.ts";
import { isTransportFailure } from "#/features/auth/auth-error.ts";
import { authClient } from "#/lib/auth.ts";
import { translator } from "#/lib/i18n/current.ts";

/**
 * Email change — **completes only when both addresses agree.**
 *
 * The request goes directly through the Better Auth client (`/v2/auth/change-email`). It is not
 * wrapped in our routes, for the same reason as password change and account deletion: wrapping
 * creates a second implementation imitating identity verification, and above all **the code that
 * creates confirmation tokens would live in this repository.**
 *
 * ## What does **not** happen here
 *
 * ```text
 * user.email UPDATE      this request changes no rows; one email is simply sent
 * account merge           even if another account uses that address, nothing is merged (the server finishes quietly)
 * member identity change  Viewer.id, the local DB scope and the sync namespace stay as they are
 * ```
 *
 * The last line is this slice's invariant. Email is a **sign-in identifier**, not product
 * ownership, so even on success the only thing reloaded is one account-info field.
 *
 * ## The user does not decide where the return goes
 *
 * The callback is built from a **constant path**. That value rides in the link delivered by mail,
 * so if a value read from the query were passed, the link would itself become a phishing path.
 * Provider linking and the confirmation mail already made the same decision. The server's
 * `trustedOrigins` adds one more layer.
 */

/** Where the change flow brings the user back: the account screen, with one marker attached. */
const RETURN_PATH = "/account?email=changed";

/** Format validation is left to zod; hand-writing an email regex is a bet on getting it wrong. */
const EmailFormat = z.email();

/**
 * Whether the input is a value we can send now — **a pure function**.
 *
 * It also checks equality with the current address because the server rejects that with a 400, and
 * that round trip can be saved. The comparison is case-insensitive: the server lowercases the new
 * address, so without folding here `Me@x.com` would pass and then be rejected.
 */
export type ChangeEmailCheck =
	| { ok: true; email: string }
	| { ok: false; reason: "empty" | "format" | "same" };

export function checkNewEmail(
	input: string,
	current: string,
): ChangeEmailCheck {
	const email = input.trim();
	if (!email) return { ok: false, reason: "empty" };
	if (!EmailFormat.safeParse(email).success)
		return { ok: false, reason: "format" };
	if (email.toLowerCase() === current.trim().toLowerCase())
		return { ok: false, reason: "same" };
	return { ok: true, email };
}

/** Validation failure → sentence. The screen does not restate the conditions. */
export function changeEmailCheckMessage(
	reason: Exclude<ChangeEmailCheck, { ok: true }>["reason"],
): string {
	switch (reason) {
		case "empty":
			return translator("account")("changeEmail.pleaseEnterANewEmail");
		case "format":
			return translator("account")("changeEmail.thatEmailAddressIsnT");
		case "same":
			return translator("account")("changeEmail.thatSTheAddressYou");
	}
}

/**
 * Starts the change — **only one email is sent.**
 *
 * For an account whose current address is verified, the approval request goes to that address; for
 * an unverified account, the ownership check goes straight to the new address. The server decides
 * which, and the screen says only "we sent a mail" either way. Stating which address received it
 * would make that sentence false in half the cases.
 */
export async function requestEmailChange(
	newEmail: string,
): Promise<AuthFailure | null> {
	const origin = typeof window === "undefined" ? "" : window.location.origin;
	return authClient
		.changeEmail({ newEmail, callbackURL: `${origin}${RETURN_PATH}` })
		.then((result) => result.error ?? null)
		.catch((): AuthFailure => ({}));
}

/**
 * Change failure → sentence.
 *
 * **Does not say "that address is already in use".** The server returns success in that case
 * (existence hiding), and even if it could say so, it must not: this form would become a lookup
 * answering "is this address signed up with RowCat".
 */
export function changeEmailErrorMessage(error: AuthFailure): string {
	if (isTransportFailure(error))
		return translator("account")("changeEmail.couldnTSendTheRequest");
	if (error.status === 429)
		return translator("account")("changeEmail.tooManyRequestsPleaseTry");
	switch (error.code) {
		case "SESSION_NOT_FRESH":
		case "SESSION_EXPIRED":
			return translator("account")("changeEmail.forSecurityARecentSign");
		case "UNAUTHORIZED":
			return translator("account")("changeEmail.youVeBeenSignedOut");
		case "INVALID_EMAIL":
			return translator("account")("changeEmail.thatEmailAddressIsnT");
		/**
		 * Deployments without a mail transport. The user has nothing they can do, so state only the fact;
		 * "please try again" would be false here.
		 */
		case "VERIFICATION_EMAIL_NOT_ENABLED":
		case "CHANGE_EMAIL_DISABLED":
			return translator("account")("changeEmail.changingEmailIsnTAvailable");
		default:
			return translator("account")("changeEmail.couldnTStartTheEmail");
	}
}

/**
 * Whether the flow has **come back** — reads and removes the address's marker (the pure part is
 * below).
 *
 * The value is not trusted. `?email=changed` is a claim anyone can type by hand; what actually
 * changed is answered by the account info fetched again (provider linking made the same judgment).
 */
export function readEmailReturn(href: string): {
	returned: boolean;
	cleanedHref: string;
} {
	const url = new URL(href);
	const flag = url.searchParams.get("email");
	if (!flag) return { returned: false, cleanedHref: href };
	url.searchParams.delete("email");
	return {
		returned: true,
		cleanedHref: `${url.pathname}${url.search}${url.hash}`,
	};
}

/**
 * Reads the marker and removes it — it disappears after one call.
 *
 * `history.replaceState` is used to bypass the router. Handling it as a navigation would add one
 * history entry, and back would return to the address just cleaned.
 */
export function consumeEmailReturn(): boolean {
	if (typeof window === "undefined") return false;
	const { returned, cleanedHref } = readEmailReturn(window.location.href);
	if (returned) window.history.replaceState(null, "", cleanedHref);
	return returned;
}
