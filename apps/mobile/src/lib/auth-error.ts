import { deferredGroup } from "./i18n/instance.ts";
/**
 * Folds an auth failure into a **fact the user can read**.
 *
 * The screen must not draw Better Auth's error object as-is. It holds English messages and internal
 * codes, some of which reveal our server configuration (`PROVIDER_NOT_FOUND` means "Google is not
 * configured on this deployment"). The user needs only **what they can do next**.
 *
 * Being a pure function is the point: `if (error.code === ...)` branches piled up inside a screen
 * cannot be checked without rendering, and a mistake there is silent (the most common failure shows
 * "unknown error").
 *
 * ## Account enumeration is not revived on screen
 *
 * The server answers "no such email" and "wrong password" with **the same code**
 * (`apps/api/src/auth/credentials.test.ts` guards that). Splitting them here into different
 * messages would undo that effort on screen: the sign-in form would become a member lookup. So all
 * credential codes fold into one bucket (`invalid_credentials`).
 */

/** The reason the screen branches on. A **fact**, neither code nor state. */
export type AuthFailure =
	| "invalid_credentials"
	| "email_taken"
	| "invalid_email"
	| "password_too_short"
	| "password_too_long"
	| "password_mismatch"
	| "name_required"
	| "too_many_attempts"
	| "provider_unavailable"
	/**
	 * **The social round trip ended with no session.** This app cannot tell what caused it.
	 *
	 * For a while this bucket was named `cancelled` with the copy `Cancelled`. That was a
	 * fact we never confirmed: someone who closed the browser sheet themselves and someone whose
	 * sign-in the server **rejected** (leaving them with no session) became the same value here.
	 * Rejection is not rare: if an account with the same email already exists and its email is
	 * unverified, Better Auth refuses implicit linking (`account_not_linked`), and if the provider
	 * gives no email, no account is created (`email_not_found`).
	 *
	 * Telling that person "cancelled" would make them read that they did something they did not do,
	 * and they would press the same button and get the same result. So both the name and the copy say
	 * only what we know (`session_without_viewer` is the same axis).
	 *
	 * This app does not yet split the cause by name. The failure returns through the deep link
	 * `?error=`, and since the round trip became ours (`auth-browser.ts`) that address does reach this
	 * code — it is read only for the one-time code today. The web reads `?error=` directly in its route,
	 * so it has one sentence per cause; doing the same here is a separate change.
	 */
	| "social_without_session"
	| "unreachable"
	/**
	 * Credentials were correct but **email ownership confirmation remains**.
	 *
	 * Only this fact splits from the credential family. It looks like a breach of the
	 * account-enumeration rule in the header, but it is not: the server gives this code **only after
	 * verifying the password** (that is the order in `sign-in/email`), so to see this sentence one
	 * must already know that account's password.
	 *
	 * Folding it into `invalid_credentials` would hurt more: the user keeps retyping the correct
	 * password, and never learns that the server has since resent the confirmation mail.
	 *
	 * **This app has no screen that resends the confirmation mail** (that is the web's job), so the
	 * copy only says where to look.
	 */
	| "email_not_verified"
	/** Authentication succeeded but `/me` returned no member — a state that must not exist. */
	| "session_without_viewer"
	| "sign_out_failed"
	/** Two-factor challenge — the authenticator app's code did not match. Retype it right there. */
	| "two_factor_invalid_code"
	/** Two-factor challenge — the backup code did not match or was already used. */
	| "two_factor_invalid_backup_code"
	/** The challenge expired (10 minutes) — retyping in the same field will not help. Start sign-in from the beginning. */
	| "two_factor_expired"
	/** Locked after too many wrong attempts — wait, then start sign-in from the beginning. */
	| "two_factor_locked"
	| "unknown";

/**
 * One sentence per failure, read from the dictionaries (`signIn.failure`, English and Korean) in the
 * current language. The table keeps its `Record<AuthFailure, string>` shape for its many callers,
 * and that annotation is what makes a value added to `AuthFailure` without a sentence fail to compile.
 *
 * Three sentences carry decisions, and a translation must keep them:
 *
 * - `provider_unavailable` and `social_without_session` name **no provider**. Naming one is done by
 *   the layer that knows which provider it was (`authFailureMessage` in `auth-social.ts`); this
 *   default must stay true when the source is unknown.
 * - `social_without_session` is **not just "try again"**. It covers failures that resolve on retry
 *   and one that never does (the account is not linked), so it also points to email sign-in, the
 *   path that is true for both.
 * - `session_without_viewer` cannot explain its cause (authentication worked, no member). "Try
 *   again" is still honest: the next request is the retry (`ensureMember` in the API).
 */
export const AUTH_FAILURE_MESSAGE: Record<AuthFailure, string> = deferredGroup(
	"signIn",
	"failure",
);

/**
 * The **axis we see** of an error returned by the Better Auth client.
 *
 * Why not accept the library type directly: this function must stay pure. Importing `better-auth`
 * would pull its graph (which reaches `react-native`), and it would not open under Node.
 */
export interface AuthErrorLike {
	code?: string | undefined;
	status?: number | undefined;
}

/** Credential family — all folded into one bucket. The account-enumeration rule in the header is this table's whole purpose. */
const CREDENTIAL_CODES = new Set([
	"INVALID_EMAIL_OR_PASSWORD",
	"INVALID_PASSWORD",
	"INVALID_USER",
	"USER_NOT_FOUND",
	"CREDENTIAL_ACCOUNT_NOT_FOUND",
	"ACCOUNT_NOT_FOUND",
]);

const CODE_FAILURE: Record<string, AuthFailure> = {
	/**
	 * Not in `CREDENTIAL_CODES` above, so it is never folded into the credential bucket. These codes
	 * come only after the credentials match, so they do not become material for account enumeration.
	 * The reason is in the union comment above.
	 */
	EMAIL_NOT_VERIFIED: "email_not_verified",
	USER_ALREADY_EXISTS: "email_taken",
	USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "email_taken",
	INVALID_EMAIL: "invalid_email",
	PASSWORD_TOO_SHORT: "password_too_short",
	PASSWORD_TOO_LONG: "password_too_long",
	PROVIDER_NOT_FOUND: "provider_unavailable",
	ID_TOKEN_NOT_SUPPORTED: "provider_unavailable",
	/** Two-factor challenge reasons — same branches as the web's `features/auth/two-factor.ts`. */
	INVALID_CODE: "two_factor_invalid_code",
	INVALID_BACKUP_CODE: "two_factor_invalid_backup_code",
	INVALID_TWO_FACTOR_COOKIE: "two_factor_expired",
	ACCOUNT_TEMPORARILY_LOCKED: "two_factor_locked",
	TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: "two_factor_locked",
};

/** Whether the challenge must be ended and sent back to the sign-in form — the cases where retyping in the same field will not help. */
export const twoFactorRestartRequired = (failure: AuthFailure): boolean =>
	failure === "two_factor_expired" || failure === "two_factor_locked";

/**
 * Whether a sign-in response means "the password was right and a second factor remains".
 *
 * That response carries no session: the server removed the session the password sign-in created and
 * left only the challenge cookie. Folding this into success would make `/me` answer guest and draw
 * a signed-in person as signed out (the same trap as a deployment where sign-up grants no session).
 */
export const isTwoFactorRedirect = (data: unknown): boolean =>
	typeof data === "object" &&
	data !== null &&
	(data as { twoFactorRedirect?: unknown }).twoFactorRedirect === true;

/**
 * One error → one fact.
 *
 * **Do not fold every failure into "wrong password".** A server being down and the password being
 * wrong call for different actions from the user: the first means waiting, the second means
 * correcting the input.
 */
export function authFailure(
	error: AuthErrorLike | null | undefined,
): AuthFailure {
	if (!error) return "unknown";

	const code = error.code?.toUpperCase();
	if (code) {
		if (CREDENTIAL_CODES.has(code)) return "invalid_credentials";
		const mapped = CODE_FAILURE[code];
		if (mapped) return mapped;
	}

	const status = error.status;
	if (status === 429) return "too_many_attempts";
	/**
	 * The status is absent (the transport itself failed) or the server returned 5xx. Neither is
	 * something the user can fix, and the action is the same (wait and retry), so both share one
	 * bucket. A 4xx with a `code` already split above, so only 4xx without a matching code reach here
	 * and fall to `unknown`.
	 */
	if (status === undefined || status === 0 || status >= 500)
		return "unreachable";

	return "unknown";
}

/** The only error this app throws during the auth procedure. Screens look only at `failure`. */
export class AuthFlowError extends Error {
	readonly failure: AuthFailure;

	constructor(failure: AuthFailure, options?: { cause?: unknown }) {
		super(AUTH_FAILURE_MESSAGE[failure], options);
		this.name = "AuthFlowError";
		this.failure = failure;
	}
}

/**
 * Thrown value → fact. A foreign error (not ours) is treated as a transport failure: an unfamiliar
 * exception that reaches here is usually one that `fetch` threw.
 */
export const authFailureOf = (error: unknown): AuthFailure =>
	error instanceof AuthFlowError ? error.failure : "unreachable";
