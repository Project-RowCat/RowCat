import { looksLikeEmail } from "../../lib/auth-credentials.ts";

/**
 * Email: the pure rules for validation and for the return from the mail flow.
 *
 * The request itself is sent by `lib/account-security-auth.ts`. Only three things that must be
 * checkable without rendering live here: whether a value can be sent now, whether it can be sent
 * again, and how to read the "we came back" marker.
 *
 * The marker is a claim, not a fact. `?email=changed` on the returning deep link is a string anyone
 * can type, so it never edits account info; it only triggers a re-fetch, and the server answers
 * what changed. The function therefore returns one boolean: with no slot for an address, no code
 * can draw one.
 *
 * No account enumeration: there is no place here to say "this address is already used by another
 * account". The server quietly succeeds in that case (existence hiding), and even if it could say
 * so it must not, or this form becomes a lookup for "did you sign up to RowCat with this address".
 */

export type ChangeEmailCheck =
	| { ok: true; email: string }
	| { ok: false; reason: "empty" | "format" | "same" };

/**
 * Whether the input can be sent now.
 *
 * It compares with the current address because the server rejects equality with a 400, so the round
 * trip can be saved. The comparison folds case since the server lowercases the new address; without
 * folding, `Me@x.com` would pass the form and then be rejected.
 *
 * Email format goes through the same predicate as the login form (`looksLikeEmail`); a second regex
 * would let the two forms accept different values, reproducible on one screen only.
 */
export function checkNewEmail(
	input: string,
	current: string,
): ChangeEmailCheck {
	const email = input.trim();
	if (!email) return { ok: false, reason: "empty" };
	if (!looksLikeEmail(email)) return { ok: false, reason: "format" };
	if (email.toLowerCase() === current.trim().toLowerCase())
		return { ok: false, reason: "same" };
	return { ok: true, email };
}

/** Maps a validation failure to a sentence so screens do not rewrite the conditions. */
export function changeEmailCheckMessage(
	reason: Exclude<ChangeEmailCheck, { ok: true }>["reason"],
): string {
	switch (reason) {
		case "empty":
			return "Please enter a new email address.";
		case "format":
			return "That email address isn't valid.";
		case "same":
			return "That's the address you're already using.";
	}
}

/**
 * Whether we came back from the email flow; accepts only the marker the app wrote.
 *
 * `expo-router` params can be a string or an array (when a key repeats), and a hand-edited deep
 * link can carry anything. Only exactly our value counts as true; `Boolean(param)` would let
 * `?email=evil` through, and code drawing that string would follow.
 *
 * The marker only triggers a re-fetch of account info and is cleared from the router after one read
 * (the screen does that; only the decision lives here).
 */
export const EMAIL_CHANGE_RETURN_VALUE = "changed";

export function isEmailChangeReturn(param: unknown): boolean {
	return param === EMAIL_CHANGE_RETURN_VALUE;
}
