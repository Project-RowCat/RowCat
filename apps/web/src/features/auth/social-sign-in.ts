import { translator } from "#/lib/i18n/current.ts";
import type { AuthFailure } from "./auth-error.ts";
import { isTransportFailure } from "./auth-error.ts";

/**
 * Social sign-in: the providers this screen offers, and the sentence to show when an attempt fails.
 *
 * The screen keeps its own provider list. `LoginMethodProvider` in `@rowcat/domain` also carries
 * `credential`, but that is the vocabulary of "methods attached to an account". This list answers a
 * different question: which buttons leave the page and come back. Credential sign-in completes
 * inside the form, so it is not on this axis. Merging the two would force every loop over this list
 * to filter out `credential`, and forgetting that filter would put a second "continue with email"
 * button on the login screen.
 *
 * The array order is the render order, and the screen does not repeat it elsewhere. Google is first
 * because most existing users of this deployment sign in with it. Kakao is last even though most
 * users are in Korea: the order sorts usage that has already accumulated here, and a newly added
 * method has none.
 */
export const SOCIAL_PROVIDERS = ["google", "apple", "kakao"] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

/**
 * Brand names are not translated (`Apple`, never a transliteration). The page the person reaches after pressing
 * uses that name, and a different spelling would leave them unsure it is the same service.
 */
export const socialProviderLabel = (provider: SocialProvider): string => {
	if (provider === "google") return "Google";
	if (provider === "apple") return "Apple";
	/**
	 * Kakao's own sign-in page names itself in the reader's language, so this is the one label that
	 * is translated. The rule is the same: match the text on the screen the person sees after pressing.
	 */
	return translator("auth")("social.kakao");
};

/**
 * Failure to start a sign-in (the tab that pressed the button is still here).
 *
 * Cancelling at the provider is not a failure. The default sentence stays neutral so that someone
 * who closed the window does not start doubting their account (passkeys already make the same
 * call).
 *
 * A provider not configured on this deployment makes the server answer 400. Swallowing that would
 * leave the button stuck on "moving…", which is the reason this mapper exists, so it draws a
 * sentence. The sentence gives no reason: deployment configuration is not something this person can
 * fix, so it points to the other options already on screen.
 */
export function socialSignInErrorMessage(
	provider: SocialProvider,
	error: AuthFailure,
): string {
	const t = translator("auth");
	const label = socialProviderLabel(provider);
	if (isTransportFailure(error))
		return t("social.startTransport", { provider: label });
	if (error.status === 429) return t("rateLimited");
	return t("social.startFailed", { provider: label });
}

/**
 * A failure that comes back from the provider. This is not the same as `socialSignInErrorMessage`:
 *
 * ```text
 * socialSignInErrorMessage    failed to leave the page     the tab that pressed the button is still alive
 * socialCallbackErrorMessage  failed after a round trip    the browser went through the provider, and this
 *                                                          component unmounted in between
 * ```
 *
 * Until this path existed, these failures never came back to our screens: Better Auth's default
 * error page was the last thing the person saw. Kakao made the path common, since email is optional
 * consent and unchecking one box on the consent screen reaches it.
 */

/**
 * Reasons we name. Only values in this list reach the screen from the URL: the route fills search
 * params from this vocabulary alone, so a string from someone else's link has no place to render
 * (the same judgment as folding `?verified` into a boolean). Anything outside the list falls
 * through to the default.
 *
 * Falling through is only safe when the next step is the same as the default's. The default says
 * "retry or use another method", so a reason that retrying can never fix would become a lie if it
 * fell through. A code gets a name only if it is reachable in this deployment's configuration and
 * retrying can resolve it.
 *
 * `email_not_found` and `account_not_linked` come from sign-in and belong to this screen.
 * `email_does_not_match` and `account_already_linked_to_different_user` come from linking on the
 * account screen. They live here because both round trips go through the same library and the same
 * vocabulary. The first two had no sentence for a long time; closing that gap is the bug this list
 * fixed.
 */
export const SOCIAL_CALLBACK_ERROR_CODES = [
	"email_not_found",
	"account_not_linked",
	"email_does_not_match",
	"account_already_linked_to_different_user",
] as const;
export type SocialCallbackErrorCode =
	(typeof SOCIAL_CALLBACK_ERROR_CODES)[number];

const isCallbackErrorCode = (
	value: unknown,
): value is SocialCallbackErrorCode =>
	typeof value === "string" &&
	(SOCIAL_CALLBACK_ERROR_CODES as readonly string[]).includes(value);

/** Maps a URL value to a known reason. Anything unknown yields `undefined`, which uses the default sentence. */
export const socialCallbackErrorCodeFrom = (
	value: unknown,
): SocialCallbackErrorCode | undefined =>
	isCallbackErrorCode(value) ? value : undefined;

/** Maps a URL value to a known provider. Without validation, a foreign string would become the sentence. */
export const socialProviderFrom = (
	value: unknown,
): SocialProvider | undefined =>
	typeof value === "string" &&
	(SOCIAL_PROVIDERS as readonly string[]).includes(value)
		? (value as SocialProvider)
		: undefined;

/**
 * Maps a returned failure to a sentence. `provider` can be missing too: it also comes from the URL
 * and is dropped if validation fails. In that case the sentence names no provider rather than
 * guessing one.
 */
export function socialCallbackErrorMessage(
	provider: SocialProvider | undefined,
	code: SocialCallbackErrorCode | undefined,
): string {
	const t = translator("auth");
	const label = provider ? socialProviderLabel(provider) : null;
	switch (code) {
		/**
		 * This function exists for this case. When the provider does not return an email, no account is
		 * created, because the server does not invent a placeholder address (the provider block in
		 * `apps/api/src/auth/index.ts` says why). The sentence points at the email consent item on
		 * purpose: a generic "sign-in failed" would make the person press the same button and uncheck the
		 * same box.
		 */
		case "email_not_found":
			return label
				? t("social.emailConsentProvider", { provider: label })
				: t("social.emailConsent");
		/**
		 * A reason the sign-in round trip actually reaches, which had no sentence for a long time. The
		 * condition is Better Auth 1.7's `accountLinking.requireLocalEmailVerified` (default true): even
		 * for a trusted provider (Google is one), implicit linking is refused unless the local account's
		 * email is verified. That is common here. The verified flag defaults to false, and accounts
		 * created before a mail transport existed were deliberately not bulk-verified (see the auth mail
		 * section in `docs`).
		 *
		 * The default sentence said "retry or use another method". Half of that is false: retrying gives
		 * the same result, and the person reads it as their account having vanished. Only one action can
		 * help, so the sentence says that.
		 *
		 * This sentence states that the account exists, unlike `email_does_not_match` below. The reason
		 * is who is reading: someone who reaches here has just finished the provider's authentication for
		 * that address, so they hold that mailbox. Telling them their own account exists is not
		 * enumeration. On the mismatch path, a signed-in person submits someone else's address, which is
		 * different.
		 */
		case "account_not_linked":
			return label
				? t("social.notLinkedProvider", { provider: label })
				: t("social.notLinked");
		/**
		 * The email differs from an existing RowCat account. It does not say which account: confirming
		 * the address here would turn this screen into a lookup for whether an email has signed up (the
		 * account screen's link failure makes the same call).
		 */
		case "email_does_not_match":
			return t("social.emailMismatch");
		case "account_already_linked_to_different_user":
			return label
				? t("social.alreadyLinkedProvider", { provider: label })
				: t("social.alreadyLinked");
		/**
		 * A person leaving the provider's page also lands here. That is not a failure, so the sentence
		 * does not assert one (same judgment as `socialSignInErrorMessage`).
		 */
		default:
			return label
				? t("social.incompleteProvider", { provider: label })
				: t("social.incomplete");
	}
}
