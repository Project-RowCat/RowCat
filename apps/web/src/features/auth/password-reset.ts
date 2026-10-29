import { PASSWORD_LENGTH } from "@rowcat/contracts";
import { z } from "zod";
import { authClient, redirectTargetFrom } from "#/lib/auth.ts";
import { translator } from "#/lib/i18n/current.ts";
import { type AuthFailure, isTransportFailure } from "./auth-error.ts";

/**
 * Password reset: **the owner of the mailbox sets the new password.**
 *
 * This file neither creates nor verifies the token; Better Auth does that
 * (`/request-password-reset` → `/reset-password/:token` → `/reset-password`). This file decides
 * only three things: **where the user returns**, **what is said**, and **whether the new password
 * may be sent to the server**.
 *
 * ## The return address is not chosen by the user
 *
 * The callback address is built from a **constant path** (`RESET_PASSWORD_PATH`). The link is
 * delivered by mail, so passing a value read from the query would turn the mail into a phishing
 * link carrying our name. This is the same decision as the verification mail
 * (`email-verification.ts`). The server's `trustedOrigins` adds another layer on top: an address
 * outside the trust list gets 403 and no mail is sent.
 *
 * The destination (`?redirect=`) is carried. Someone who pressed `Forgot your password?` on the sign-in
 * screen was on the way somewhere, and this is where the verification mail once lost its
 * destination and caused a real incident (see the header of `email-verification.ts`). The value
 * passes through `redirectTargetFrom` once more, so only this app's internal paths can be carried.
 *
 * ## It never says "that address is not registered"
 *
 * The server returns the same success for unknown addresses (existence hiding) and also makes the
 * response time the same (`apps/api/src/auth/index.ts`, which does not wait for the mail). The rule
 * for sentences in this file is never to undo that fact on screen: a sentence shown after sending
 * always starts with "if the address is registered".
 *
 * ## What is deliberately **not** here
 *
 * ```text
 * carrying the email in the address   the address typed on the sign-in screen is not passed in the query; the user retypes it
 * auto sign-in after reset            the library does not do it and neither do we (the user signs in with the new password)
 * security questions · SMS codes      no such procedure exists. Mailbox ownership is the only proof in this flow
 * ```
 */

/** Where the link brings the user back. It pairs with the route (`routes/reset-password.tsx`). */
export const RESET_PASSWORD_PATH = "/reset-password";

/**
 * The absolute address the mail link brings the user to.
 *
 * During server rendering there is no origin. This function is called only from submit handlers,
 * and there it returns `undefined` so the caller omits the value.
 *
 * The library **appends** `token` (or `error=INVALID_TOKEN`) to this address. It is set through
 * `searchParams.set` rather than by concatenating the query, so it coexists with `?redirect=`.
 */
export function passwordResetCallbackUrl(
	returnPath?: string,
): string | undefined {
	if (typeof window === "undefined") return undefined;
	const target = redirectTargetFrom(returnPath);
	const search = target ? `?redirect=${encodeURIComponent(target)}` : "";
	return `${window.location.origin}${RESET_PASSWORD_PATH}${search}`;
}

/** Format validation is delegated to zod; a hand-written email regex is wrong in more cases. */
const EmailFormat = z.email();

/** Whether the address that will receive the reset mail is a value that can be sent now. */
export type ResetEmailCheck =
	| { ok: true; email: string }
	| { ok: false; message: string };

export function checkResetEmail(input: string): ResetEmailCheck {
	const email = input.trim();
	if (!email)
		return { ok: false, message: translator("auth")("reset.emailRequired") };
	if (!EmailFormat.safeParse(email).success)
		return { ok: false, message: translator("auth")("invalidEmail") };
	return { ok: true, email };
}

/**
 * Whether the new password is a value that can be sent now. **Pure function.**
 *
 * The length source is the single contract (`PASSWORD_LENGTH`). The password is not trimmed:
 * whitespace is part of the password the user chose, and trimming it here would make the stored
 * value differ from the one typed at the next sign-in.
 */
export type NewPasswordIssue = "empty" | "too_short" | "too_long" | "mismatch";

export function checkNewPassword(
	password: string,
	confirm: string,
): NewPasswordIssue | null {
	if (!password) return "empty";
	if (password.length < PASSWORD_LENGTH.min) return "too_short";
	if (password.length > PASSWORD_LENGTH.max) return "too_long";
	if (password !== confirm) return "mismatch";
	return null;
}

export function newPasswordIssueMessage(issue: NewPasswordIssue): string {
	switch (issue) {
		case "empty":
			return translator("auth")("newPasswordRequired");
		case "too_short":
			return translator("auth")("passwordTooShort", {
				min: PASSWORD_LENGTH.min,
			});
		case "too_long":
			return translator("auth")("passwordTooLong", {
				max: PASSWORD_LENGTH.max,
			});
		case "mismatch":
			return translator("auth")("passwordMismatch");
	}
}

/**
 * Requests the reset mail.
 *
 * No route of our own: Better Auth already exposes it over HTTP and it can be called without a
 * session. A failure where no response arrived at all is folded into an empty object (which
 * `isTransportFailure` treats as true).
 */
export async function requestPasswordReset(
	email: string,
	returnPath?: string,
): Promise<AuthFailure | null> {
	const redirectTo = passwordResetCallbackUrl(returnPath);
	return authClient
		.requestPasswordReset({ email, ...(redirectTo ? { redirectTo } : {}) })
		.then((result) => result.error ?? null)
		.catch((): AuthFailure => ({}));
}

/** Sets the new password. The token is the single value the mail link returned. */
export async function resetPassword(
	token: string,
	newPassword: string,
): Promise<AuthFailure | null> {
	return authClient
		.resetPassword({ token, newPassword })
		.then((result) => result.error ?? null)
		.catch((): AuthFailure => ({}));
}

const rateLimited = (): string => translator("auth")("rateLimited");

/**
 * This deployment cannot send reset mail (`RESET_PASSWORD_DISABLED`).
 *
 * The server emits this code when no sender is **registered** because no delivery channel exists.
 * Registering one and sending nothing silently would leave the user waiting for a mail that never
 * comes. The screen does not hide the fact; it points to the remaining route (another sign-in
 * method) and does not talk about server configuration.
 */
const RESET_DISABLED = "RESET_PASSWORD_DISABLED";

/** Maps a reset-mail request failure to a sentence. `that address does not exist` cannot arrive here (existence hiding). */
export function requestResetErrorMessage(error: AuthFailure): string {
	if (isTransportFailure(error))
		return translator("auth")("reset.requestTransport");
	if (error.status === 429) return rateLimited();
	if (error.code === RESET_DISABLED)
		return translator("auth")("reset.disabled");
	return translator("auth")("reset.requestFailed");
}

/**
 * Maps a new-password submit failure to the next state.
 *
 * The point is that there are two branches. If the token is dead (expired, already used, or
 * missing), nothing on this form can fix it, so the screen **switches to the face that asks for
 * another mail** (`linkExpired`). Other failures stay on the form, because the token is still
 * alive: an attempt that fails the length rule does not consume it.
 */
export type ResetFailure =
	| { kind: "link_expired" }
	| { kind: "retry"; message: string };

export function resetFailureOf(error: AuthFailure): ResetFailure {
	if (error.code === "INVALID_TOKEN" || error.code === "USER_NOT_FOUND")
		return { kind: "link_expired" };
	if (isTransportFailure(error))
		return {
			kind: "retry",
			message: translator("auth")("reset.changeTransport"),
		};
	if (error.status === 429) return { kind: "retry", message: rateLimited() };
	if (error.code === "PASSWORD_TOO_SHORT")
		return { kind: "retry", message: newPasswordIssueMessage("too_short") };
	if (error.code === "PASSWORD_TOO_LONG")
		return { kind: "retry", message: newPasswordIssueMessage("too_long") };
	return {
		kind: "retry",
		message: translator("auth")("reset.changeFailed"),
	};
}

/**
 * Whether to accept the token the link returned.
 *
 * The library's token is 24 alphanumeric characters. The shape is accepted broadly, but length and
 * character set are bounded because this value comes **from the address bar**. The screen never
 * draws it, but there is also no reason for a value of arbitrary length and content to be sent to
 * the server.
 */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{8,128}$/;

export function resetTokenFrom(value: unknown): string | undefined {
	return typeof value === "string" && TOKEN_SHAPE.test(value)
		? value
		: undefined;
}
