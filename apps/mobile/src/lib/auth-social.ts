import { AUTH_FAILURE_MESSAGE, type AuthFailure } from "./auth-error.ts";

/**
 * Social sign-in: which providers this app opens, and what their failure says.
 *
 * The vocabulary is narrower than `LoginMethodProvider` in `@rowcat/domain`. That one lists the
 * methods linked to an account, credentials included. Here the question is which button leaves the
 * app and comes back, so credentials are not on this axis (the email form finishes on this screen).
 * The web's `features/auth/social-sign-in.ts` makes the same split for the same reason.
 *
 * The list order is the render order. Google comes first because most existing users arrive with
 * it. The screen does not restate the order, so adding a provider touches one place.
 *
 * Kakao is not here yet. The web list has a third entry, but this app has no mark for it
 * (`BrandName` in `@rowcat/ui-native`), and adding the vocabulary first would create a button with
 * nothing to draw. It arrives together with its mark.
 *
 * A visible button does not mean the deployment registers that provider. Apple registration
 * (`APPLE_SIGN_IN_*`) must stay empty until the policy's effective date. On such a deployment the
 * server answers `PROVIDER_NOT_FOUND`, and the failure becomes a sentence naming that provider, the
 * same one the web draws. This list does not read deployment settings: that would require fetching
 * provider availability at boot, and the login screen would render without knowing what it can do
 * while that request is in flight. `GET /v2/runtime-config` has no such field.
 */

/** Vocabulary and render order. A subset of `BrandName`, so a value without a mark cannot appear. */
export const SOCIAL_PROVIDERS = ["google", "apple"] as const;

export type SocialProvider = (typeof SOCIAL_PROVIDERS)[number];

/**
 * Button label. Brand names are not translated (`Apple` stays `Apple`): the screen the user lands on
 * uses the brand name, and a different spelling would make it unclear whether they are the same.
 *
 * `Record` on purpose: adding a value to the vocabulary above breaks compilation here.
 */
export const SOCIAL_PROVIDER_LABEL: Record<SocialProvider, string> = {
	google: "Google",
	apple: "Apple",
};

/** Flow name → provider. `null` when the flow is not a social round trip. */
export const socialProviderOf = (action: string): SocialProvider | null =>
	(SOCIAL_PROVIDERS as readonly string[]).includes(action)
		? (action as SocialProvider)
		: null;

/**
 * The last failure, including the flow it came from.
 *
 * While only the reason was stored, this app's social failure copy hard-coded `Google`. That was
 * true while Google was the only provider. Once there were two, a failed Apple sign-in showed a
 * sentence asking the user to check Google: it compiled and passed the tests, and only the person
 * reading it could tell it was wrong.
 *
 * The two stay in one value on purpose. The fact and its source are always created and cleared
 * together, and two parallel slots would eventually produce a frame where only one was updated.
 */
export interface IdentityFailure {
	reason: AuthFailure;
	/** The provider for a social round trip; `null` for email and sign-out failures. */
	provider: SocialProvider | null;
}

/**
 * Only the failures reachable through a social round trip. Everything else uses the shared table
 * unchanged. A failure gets a row here only when knowing the provider makes its guidance more
 * accurate.
 */
const SOCIAL_MESSAGE: Partial<Record<AuthFailure, (label: string) => string>> =
	{
		provider_unavailable: (label) =>
			`${label} sign-in isn't available right now.`,
		/**
		 * Does not say only "try again". Two cases share this cell: ones a retry resolves (cancelled or
		 * transient failures) and ones it never does (the identity is not linked to an existing account).
		 * The sentence therefore also names the path that is always true in this app, email sign-in.
		 */
		social_without_session: (label) =>
			`${label} sign-in didn't complete. Try again, or if you've signed up with this email before, sign in with your email.`,
	};

/**
 * Failure → the sentence shown on screen.
 *
 * With no provider it falls back to the shared table. That sentence must be true without a name
 * (the two columns of `auth-error.ts` are written that way), so no name is invented here.
 */
export function authFailureMessage(failure: IdentityFailure): string {
	const { provider, reason } = failure;
	const write = provider ? SOCIAL_MESSAGE[reason] : undefined;
	return provider && write
		? write(SOCIAL_PROVIDER_LABEL[provider])
		: AUTH_FAILURE_MESSAGE[reason];
}

/**
 * Button label, which says when the screen is leaving. Same sentence as the web (`Continue with …` ↔ `Going to
 * …`).
 *
 * Google's button here used to read `Continue on Google`. Apple's guidelines restrict its button title to
 * one of a fixed set (`Sign in with Apple`, `Continue with Apple`, `Sign up with Apple`), and `Continue on Apple` is none
 * of them. A different ending per provider would make two buttons of the same rank read as
 * different sentences, so both share one ending. Width does not matter: the buttons fill the row
 * and stand one per line.
 */
export const socialSignInLabel = (
	provider: SocialProvider,
	pending: boolean,
): string =>
	pending
		? `Going to ${SOCIAL_PROVIDER_LABEL[provider]}…`
		: `Continue with ${SOCIAL_PROVIDER_LABEL[provider]}`;
