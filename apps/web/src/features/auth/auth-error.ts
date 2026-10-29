import { translator } from "#/lib/i18n/current.ts";
/**
 * Maps an auth failure to a sentence a person can read.
 *
 * Two reasons not to draw Better Auth's string (`"Invalid email or password"`) directly. One is
 * language: the product is in Korean and the library's messages are in English. The more important
 * one: those strings are the library's internal representation and change silently between
 * versions. Showing them directly would change our product copy through a dependency upgrade, and
 * no test would catch it.
 *
 * So only the code (`error.code`) is read, and the sentence is decided here. Unknown codes fall
 * back to a generic message, so a new failure type does not turn the screen into English.
 */

/** Password length policy. The server is the final authority (`emailAndPassword` in apps/api/src/auth/index.ts). */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

/** Sign-in or sign-up: the same failure gets different guidance. */
export type AuthMode = "signin" | "signup";

/**
 * The value the Better Auth client returns in the `error` slot of `{ data, error }`.
 *
 * The library types are not imported; only the fields we read are declared. Structural typing means
 * the real value fits as is.
 */
export interface AuthFailure {
	code?: string;
	status?: number;
	statusText?: string;
	message?: string;
}

/**
 * The network dropped or the server was unreachable: there is no response, so no status code
 * exists.
 *
 * This lives next to `AuthFailure` because the predicate states a fact about that shape, not a
 * sign-in rule. The account-deletion side (`delete-account-error.ts`) reads the same shape and uses
 * it too. **The copy is not shared**: the two screens must say opposite things on this branch
 * (sign-in asks the person to retry; deletion must warn that the account may already be gone).
 */
export const isTransportFailure = (error: AuthFailure): boolean =>
	!error.status || error.status === 0;

/**
 * The password was correct, but **the email is not yet verified**.
 *
 * This branch alone states its reason, which looks like it breaks the rule in `authErrorMessage`
 * below. It does not. The server returns this code only **after verifying the password** (sign-in
 * checks in that order), so seeing the sentence already requires knowing that account's password.
 * It is not a member lookup.
 *
 * Folding this branch into "email or password is incorrect" would make the person keep retyping a
 * correct password, and they would never learn that the verification mail had just been sent again.
 */
export const EMAIL_NOT_VERIFIED = "EMAIL_NOT_VERIFIED";

/** Is sign-in blocked by the pending-verification state? Decides whether the screen switches to the confirmation guidance. */
export const isEmailNotVerified = (error: AuthFailure): boolean =>
	error.code === EMAIL_NOT_VERIFIED;

/**
 * Sign-up failures must state a reason to be fixable: whether the password is too short or the
 * format is wrong is information the person can act on.
 *
 * ## Some deployments no longer show the duplicate-email message
 *
 * Where email ownership verification is required, Better Auth answers a sign-up with an existing
 * address with a **success-looking response** (`shouldReturnGenericDuplicateResponse`). The library
 * does this on purpose to hide existence, and we do not undo it. Undoing it would turn the sign-up
 * form into a lookup for "is this email registered with RowCat".
 *
 * So the two duplicate lines below are reached **only in deployments that do not require
 * verification**. They are kept because such deployments exist (local development), where stating
 * the reason is the right behavior.
 */
const signupMessage = (code: string): string | undefined => {
	const t = translator("auth");
	switch (code) {
		case "USER_ALREADY_EXISTS":
		case "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL":
			return t("emailTaken");
		case "PASSWORD_TOO_SHORT":
			return t("passwordTooShort", { min: PASSWORD_MIN_LENGTH });
		case "PASSWORD_TOO_LONG":
			return t("passwordTooLong", { max: PASSWORD_MAX_LENGTH });
		case "INVALID_EMAIL":
			return t("invalidEmail");
		default:
			return undefined;
	}
};

/**
 * The sentence to draw on screen.
 *
 * The core of this function is that sign-in **deliberately blurs** the reason. If the form
 * distinguished "no such email" from "wrong password", the sign-in form would become a member
 * lookup: enter an email and watch whether the message changes to learn whether the account exists.
 * So only 429 (too many requests) and transport failure get their own sentences; every other
 * failure gets the same single sentence.
 */
export function authErrorMessage(mode: AuthMode, error: AuthFailure): string {
	const t = translator("auth");
	if (isTransportFailure(error))
		return mode === "signin" ? t("signinTransport") : t("signupTransport");

	if (error.status === 429) return t("rateLimited");

	/**
	 * Pending verification is a **next step**, not a failure. The screen switches to the confirmation
	 * panel instead of this sentence (`isEmailNotVerified`), but callers that do not take that path
	 * still get an accurate sentence. Folding it into the generic message here would make only that
	 * screen lie.
	 */
	if (isEmailNotVerified(error)) return t("emailNotVerified");

	if (mode === "signin") return t("invalidCredentials");

	return (error.code && signupMessage(error.code)) || t("signupFailed");
}

/**
 * Sign-out did not complete.
 *
 * The reason is not split: this operation has one branch (is the session gone?). Whatever the
 * failure kind, **the fact the user needs is the same**: they are still signed in.
 *
 * The sentence lives here because two places call it: the account menu in the header, and the exit
 * path of the entry gate (`features/onboarding/gate-shell.tsx`). If each wrote its own, only the
 * gate's copy would go stale. That is the place a trapped person uses, so it has to be the most
 * accurate.
 */
export const signOutFailed = (): string => translator("auth")("signOutFailed");

/**
 * Diagnostic logged only in development.
 *
 * As user-facing messages become more general, developers lose the means to see the cause. So only
 * the code and status are logged to close that gap. **Input values are never included**: not the
 * email, certainly not the password, and not the whole request body. Logs are permanent copies, so
 * a leak cannot be undone.
 *
 * In production bundles `import.meta.env.DEV` folds to false and this call disappears entirely.
 */
export function logAuthFailure(mode: AuthMode, error: AuthFailure): void {
	if (!import.meta.env.DEV) return;
	console.warn(
		`[auth] ${mode} failed — code=${error.code ?? "(none)"} status=${error.status ?? "(none)"}`,
	);
}
