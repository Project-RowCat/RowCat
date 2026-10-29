import type { LoginMethodProvider } from "@rowcat/domain";
import { authClient } from "./auth.ts";
import type { AuthErrorLike } from "./auth-error.ts";

/**
 * The only place that calls Better Auth directly for account security.
 *
 * Feature code (`features/account/`) does not hold the auth client. It sits on the same axis as the
 * sign-out owner being `session-transition.ts` alone, for the same reason: if screens grabbed the
 * client directly, callback URLs, error shapes and session cleanup would be written slightly
 * differently per screen, and one of them would inevitably skip verification.
 *
 * ## Which operation goes through which route
 *
 * The criterion is one question: **has Better Auth already opened this operation over HTTP?**
 *
 * ```text
 * change password              here (POST /v2/auth/change-password)       the current password does not cross our contract
 * change email                 here (POST /v2/auth/change-email)          we do not build the confirmation token
 * resend verification          here (POST /v2/auth/send-verification-email)
 * link provider                here (POST /v2/auth/link-social)           the OAuth round trip is the library's
 * ───────────────────────────────────────────────────────────────────────────────
 * set password                 RowCat route                               setPassword is serverOnly
 * unlink · sessions · passkeys RowCat routes                              sanitized projection and ownership checks
 * ```
 *
 * ## The password does not leave this file
 *
 * It is taken as an argument and only sent in the request. It is not carried in
 * `@rowcat/contracts`, `@rowcat/sdk`, the query cache, SQLite or SecureStore, and not in failure
 * objects (the only things we build are `code` and `status`).
 *
 * ## The caller does not choose where the user returns
 *
 * The callback paths are constants of this file. Having no argument to pass them is the point: an
 * argument would be an open redirect, and for email change the link is **delivered by mail**, which
 * makes it far more expensive than the sign-in screen's `?redirect=`. A value starting with `/` is
 * turned into this app's deep link by `@better-auth/expo` via `Linking.createURL` (the `init` hook
 * in `client.js`); the server then checks it again against `trustedOrigins`.
 *
 * ## Linking is not signing in
 *
 * This file never calls `authClient.signIn.social`. That path looks up the owner of the provider
 * identity and **creates a new account when there is none**; calling it from the account screen
 * would create a second RowCat member with no local data and no works. `link-social` instead
 * **binds** that identity to the current session's user. Success does not move the Better Auth user
 * or `member.id`, so the per-member SQLite scope and sync namespace stay as they are.
 */

/** The account screen path. Every destination this file builds derives from here. */
const ACCOUNT_PATH = "/account";

/**
 * The return destination of the email-change flow: the account screen, with one marker.
 *
 * The marker says only **that the user came back**. What changed is answered by the re-fetched
 * account details, and the screen draws that value (see the header of `isEmailChangeReturn` in
 * `email-change.ts`).
 */
const EMAIL_CHANGED_PATH = `${ACCOUNT_PATH}?email=changed`;

/**
 * Destination of provider linking: **success and failure share one path.**
 *
 * The web sends `?connected=<provider>` and `?connect=error` on the return URL and reads them
 * there; this app does not need to. `@better-auth/expo` runs the round trip in a **browser
 * session** (`openAuthSessionAsync`), and when that session redirects to this path it closes the
 * sheet and hands control back here. The app does not leave the screen in between.
 *
 * So the outcome is judged by the **account information the server confirms**, not by the address.
 * Carrying no marker is the structural form of that rule: with nothing to read, no code can use a
 * marker to correct the list.
 */
const CONNECT_RETURN_PATH = ACCOUNT_PATH;

/**
 * Providers this app can **link**.
 *
 * Only the credential is removed from the vocabulary. That method is set up by setting a password,
 * not by an OAuth round trip, and the password section owns that operation; two entrances to one
 * operation would drift apart.
 */
export type ConnectableProvider = Exclude<LoginMethodProvider, "credential">;

/**
 * `null` when there is no error.
 *
 * The Better Auth client **resolves** a response that carried a failure as `{ error }`, and throws
 * only when transport itself failed. If that throw were not caught the screen would stay in
 * progress forever, so it is folded here into one shape: an empty object means "no response
 * arrived" (`securityErrorMessage` reads that shape).
 */
type AuthOutcome = Promise<AuthErrorLike | null>;

const settle = (result: { error?: unknown } | null): AuthErrorLike | null =>
	(result?.error as AuthErrorLike | undefined) ?? null;

const transportFailure = (): AuthErrorLike => ({});

/**
 * Password **change**: verifies the current password.
 *
 * `revokeOtherSessions` is **not** passed. The library offers that option, but a password change
 * that silently signs other devices out would read to the user as something they did not do. That
 * operation has its own confirmation in the active sessions section.
 *
 * **The password is not tidied.** Applying `trim` or any normalization would make a password with
 * leading or trailing spaces work only on the device that created it (the same rule as the header
 * of `auth-credentials.ts`).
 */
export function changeAccountPassword(input: {
	currentPassword: string;
	newPassword: string;
}): AuthOutcome {
	return authClient
		.changePassword({
			currentPassword: input.currentPassword,
			newPassword: input.newPassword,
		})
		.then(settle)
		.catch(transportFailure);
}

/**
 * Starts an email change — it sends one mail and nothing more.
 *
 * This request does not change `user.email`. For an account whose current address is verified, an
 * approval request goes to that address; for an unverified account, the ownership confirmation goes
 * straight to the new address. The server decides which path applies, so the screen says only "we
 * sent a mail" either way.
 *
 * If an account already uses that address, the library does **nothing and returns success**
 * (existence hiding). The repository has no path that merges accounts, and the screen does not say
 * so.
 */
export function requestAccountEmailChange(newEmail: string): AuthOutcome {
	return authClient
		.changeEmail({ newEmail, callbackURL: EMAIL_CHANGED_PATH })
		.then(settle)
		.catch(transportFailure);
}

/**
 * Resends the verification mail.
 *
 * We build no route of our own: Better Auth already opens `/v2/auth/send-verification-email`, and
 * that route applies existence hiding by its own rules. Success means **accepted**, not confirmed.
 */
export function resendAccountVerificationEmail(email: string): AuthOutcome {
	return authClient
		.sendVerificationEmail({ email, callbackURL: EMAIL_CHANGED_PATH })
		.then(settle)
		.catch(transportFailure);
}

/**
 * Links a provider to the current account — a browser sheet opens and closes.
 *
 * `@better-auth/expo` reads the `redirect` in the `/link-social` response, opens an auth session
 * (`openAuthSessionAsync`), takes the cookie from the return address, stores it, and then completes
 * this promise. **It does not say whether the result was success or cancellation** — the plugin
 * ends quietly when `result.type !== "success"`.
 *
 * So this function answers only "was there an error", and **does not answer whether linking
 * happened.** That judgement is made by the account information re-fetched after the round trip (a
 * rule for the caller).
 */
export function linkAccountProvider(
	provider: ConnectableProvider,
): AuthOutcome {
	return authClient
		.linkSocial({
			provider,
			callbackURL: CONNECT_RETURN_PATH,
			/**
			 * Failures return to the app too. Without this the library sends the user to its default error
			 * page (`{API}/v2/auth/error`); that address is not an app scheme, so **the browser sheet does
			 * not close by itself**. The sign-in side passes the same value for the same reason.
			 */
			errorCallbackURL: CONNECT_RETURN_PATH,
		})
		.then(settle)
		.catch(transportFailure);
}
