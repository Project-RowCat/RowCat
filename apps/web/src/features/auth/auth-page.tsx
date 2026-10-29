import { refreshViewerState, runtimeConfigQueryOptions } from "@rowcat/query";
import { Button } from "@rowcat/ui-web/components/button";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getRouteApi, Link, useNavigate } from "@tanstack/react-router";
import { KeyRound } from "lucide-react";
import { type ReactElement, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getRowCatClient } from "#/lib/api.ts";
import {
	DEFAULT_REDIRECT_PATH,
	isPasskeySupported,
	redirectTargetFrom,
	signInWithApple,
	signInWithGoogle,
	signInWithKakao,
	signInWithPasskey,
} from "#/lib/auth.ts";
import { PageEnter } from "#/lib/motion/page-transition.tsx";
import { showErrorToast } from "#/lib/toast.ts";
import { AppleMark } from "./apple-mark.tsx";
import type { AuthFailure, AuthMode } from "./auth-error.ts";
import { logAuthFailure } from "./auth-error.ts";
import { type AuthPending, CredentialsForm } from "./credentials-form.tsx";
import { GoogleMark } from "./google-mark.tsx";
import { KakaoMark } from "./kakao-mark.tsx";
import { passkeySignInErrorMessage } from "./passkey-sign-in.ts";
import {
	SOCIAL_PROVIDERS,
	type SocialProvider,
	socialCallbackErrorMessage,
	socialProviderLabel,
	socialSignInErrorMessage,
} from "./social-sign-in.ts";
import { TwoFactorChallenge } from "./two-factor-challenge.tsx";
import { VerificationNotice } from "./verification-notice.tsx";

const route = getRouteApi("/login");

/**
 * Method → the function that starts it.
 *
 * A table on purpose. A ternary would let a new entry in the list start the wrong provider **while
 * still compiling**, a mismatch nobody finds until the button is pressed. `Record<SocialProvider,
 * …>` cannot express that state.
 */
const START_SOCIAL_SIGN_IN: Record<
	SocialProvider,
	(redirectPath: string) => Promise<unknown>
> = {
	google: signInWithGoogle,
	apple: signInWithApple,
	kakao: signInWithKakao,
};

/** Method → brand mark. A table for the same reason as above. */
const SOCIAL_MARK: Record<SocialProvider, () => ReactElement> = {
	google: GoogleMark,
	apple: AppleMark,
	kakao: KakaoMark,
};

/**
 * Picks the mark from the table and renders it.
 *
 * A wrapper component is needed because of a JSX rule: a lowercase variable is read as an HTML
 * element name, not as a component, so the value taken from the table cannot be used directly in
 * that position.
 */
function Mark({ provider }: { provider: SocialProvider }) {
	const Glyph = SOCIAL_MARK[provider];
	return <Glyph />;
}

/**
 * Sign-in screen: email/password and the social providers sit side by side.
 *
 * The methods share one screen because the result is the same. Whichever way someone enters, the
 * same Better Auth session is created, and the product identity after that is resolved by `/me`
 * along one path. So there is only one success handler (`handleAuthenticated`). Adding per-method
 * follow-up work would create bugs of the kind "it fails only when signing in with Google".
 *
 * **The social buttons also come from one list** (`SOCIAL_PROVIDERS` in `social-sign-in.ts`).
 * Writing the buttons by hand means one of them misses `pending` handling or swallows failures, and
 * that mismatch shows up only to people using that method. Apple's arrival is where this actually
 * surfaced.
 *
 * The two things that differ per method (the start function and the mark) are **tables, not
 * ternaries**. It used to be `provider === "google" ? … : …`, a shape that silently goes wrong when
 * a third provider arrives: the Kakao button wears the Apple mark and starts Apple sign-in, and
 * both compile and pass tests. With `Record<SocialProvider, …>`, adding a value to the list now
 * **breaks compilation first.**
 *
 * The app header (AppShell) is not used. It has a sign-in button, which would point the sign-in
 * screen at itself. This screen has one job, so a search axis or theme toggle has no reason to
 * split attention.
 */
export function AuthPage() {
	const { t } = useTranslation("auth");
	const search = route.useSearch();
	const isSignUp = search.mode === "signup";
	/**
	 * The destination is decided right before writing. The route's `validateSearch` has already
	 * filtered it, but the result is not trusted: this router version has paths where raw, unvalidated
	 * search parameters arrive as-is. There is only one decision function, so calling it twice costs
	 * nothing, and there is no place to forget it.
	 *
	 * Two values are split because navigation needs a default destination, but **links do not carry
	 * it**. `?redirect=%2F` would make an address that means nothing, and cutting it here also stops a
	 * filtered value from coming back through a link.
	 */
	const redirectTarget = redirectTargetFrom(search.redirect);
	const redirectPath = redirectTarget ?? DEFAULT_REDIRECT_PATH;

	const queryClient = useQueryClient();
	const navigate = useNavigate();
	/**
	 * Whether this deployment opens password reset. The route loader fetches the value in advance.
	 *
	 * If it is unknown (before the query or on failure), read it as closed. Drawing the link on a
	 * closed deployment would leave a dead path that only ends in "cannot send here".
	 */
	const runtimeConfig = useQuery(runtimeConfigQueryOptions(getRowCatClient()));
	const passwordResetAvailable = runtimeConfig.data?.passwordReset === true;
	const [pending, setPending] = useState<AuthPending>(null);
	/**
	 * Verification-pending state: what someone with **no session** sees.
	 *
	 * A separate route is not created, because that address could not say what it means.
	 * (`/verify-email?email=…` is a link anyone can construct, and calling resend with that value
	 * would turn it into a surface that mails any address.) This state arises from this very screen,
	 * so this screen owns it.
	 */
	const [awaitingVerification, setAwaitingVerification] = useState<{
		email: string;
		mode: AuthMode;
	} | null>(null);
	/**
	 * Two-factor challenge: the password was correct, but there is no session yet. Like the
	 * verification-pending state, this is the screen's own state rather than a route. The challenge
	 * cookie lives only in this browser, and there is no value to move into an address.
	 *
	 * `restartNotice` is the line shown above the sign-in form when the challenge ended by expiry or
	 * lockout and returned to the form. Going back without a reason would leave people not knowing why
	 * the code they just typed disappeared.
	 */
	const [awaitingTwoFactor, setAwaitingTwoFactor] = useState(false);
	const [restartNotice, setRestartNotice] = useState<string | null>(null);
	/**
	 * **Failures that do not leave the page go to a toast**, because this screen has no place for them
	 * to stand.
	 *
	 * Social and passkey buttons either leave the screen as soon as they are pressed or open a browser
	 * ceremony, so a failure leaves only "a button that looks like nothing happened". For a while that
	 * sentence was small print under the button, but by then the eye had already left the pressed
	 * spot, so it was easy to miss (the spot a recording of the problem showed).
	 *
	 * **`search.authError` below does not come here.** That is state the address carries: it stays
	 * true after a refresh and must already be in the first HTML the server renders. The distinction
	 * is held by the header of `lib/toast.ts`. The credentials form likewise speaks next to its own
	 * field.
	 */
	/**
	 * Whether to draw the passkey button — **decided in an effect.**
	 *
	 * Reading `window.PublicKeyCredential` during render would make the server-rendered HTML (always
	 * "absent") and the hydrated result diverge. Effects run only in the browser, so the button is
	 * absent in the first frame and appears right after. That one frame costs less than a markup
	 * mismatch.
	 */
	const [passkeyReady, setPasskeyReady] = useState(false);
	useEffect(() => setPasskeyReady(isPasskeySupported()), []);

	/**
	 * After a session is created.
	 *
	 * The viewer is not constructed by hand. Clear the held server state and navigate; the
	 * destination's loader and the header then refetch `/me` through the queries they normally use.
	 * Sign-in creates no special path.
	 *
	 * `replace` because the sign-in screen is not a place to return to with back. If it stayed in
	 * history, someone who just signed in would see the sign-in form again with one back press.
	 */
	const handleAuthenticated = async () => {
		await refreshViewerState(queryClient);
		// The destination is an in-app path that has passed validation (the route's validateSearch
		// filtered it). It is not an arbitrary string, so passing it to `href` does not create an open
		// redirect.
		await navigate({ href: redirectPath, replace: true });
	};

	/**
	 * Social sign-in. **On success this function never reaches the end.**
	 *
	 * The browser leaves for the provider, so this component disappears. That is why `finally` does
	 * not reset the pending state (resetting it would flash the button in its normal look for a frame
	 * just before leaving). The only time control **comes back here is on failure**, and then the
	 * function does two things: releases the pending state, and records one line of what happened.
	 *
	 * Failures arrive in two shapes, and that is the one confusing spot in this wiring. A failure that
	 * got a response **resolves** with `{ error }` (an unconfigured provider lands here); a failure
	 * where no response arrived at all is thrown.
	 */
	const handleSocial = (provider: SocialProvider): void => {
		setPending(provider);
		const start = START_SOCIAL_SIGN_IN[provider];
		void start(redirectPath)
			.then((result) => {
				const failure = (result as { error?: AuthFailure | null } | null)
					?.error;
				if (!failure) return;
				logAuthFailure("signin", failure);
				showErrorToast(socialSignInErrorMessage(provider, failure));
				setPending(null);
			})
			.catch(() => {
				showErrorToast(socialSignInErrorMessage(provider, {}));
				setPending(null);
			});
	};

	/**
	 * Passkey sign-in. On success it ends on **the same path** as the one above.
	 *
	 * This line is where the passkey identity invariant is kept. Writing separate code here to open
	 * local data would let only this path open a different scope, and the mismatch would appear as
	 * "the conversations are empty only when signing in with a passkey". After a session exists, `/me`
	 * always answers.
	 */
	const handlePasskey = (): void => {
		setPending("passkey");
		void signInWithPasskey()
			.then(async (result) => {
				const failure = (result as { error?: AuthFailure | null } | null)
					?.error;
				if (failure) {
					logAuthFailure("signin", failure);
					showErrorToast(passkeySignInErrorMessage(failure));
					return;
				}
				await handleAuthenticated();
			})
			.catch(() => {
				/**
				 * No response arrived, or the browser ceremony threw (user cancellation arrives here). The
				 * caught error is not drawn, because its message carries internal details.
				 */
				showErrorToast(passkeySignInErrorMessage({}));
			})
			.finally(() => setPending(null));
	};

	return (
		/*
		 * This screen exists entirely for this one task, so the form is not placed on a blank page; it
		 * stands as one panel in the middle. On a screen with no heading, a few borderless inputs alone
		 * look like a screen that has not finished drawing.
		 *
		 * `justify-center` and `py-10` go together because of short screens. Sign-up mode has four
		 * fields, so centering alone would clip the content off screen; with margins it scrolls naturally
		 * at that point.
		 */
		<main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
			{/*
			 * Nothing on this screen waits: login state was already settled by `beforeLoad`, and the form is complete from the start.
			 * So there is no placeholder, only the same single entrance as other screens. Input fields are not revealed one by one,
			 * because this is the animation seen on every visit, and signing in is a screen people come to finish quickly.
			 */}
			<PageEnter className="w-full max-w-sm">
				<div className="flex flex-col items-center gap-1.5 text-center">
					{/*
					 * The brand is a real link home. This screen has no heading, so there is otherwise no way to go back to browsing without
					 * signing in.
					 */}
					<Link
						to="/"
						search={{}}
						className="text-2xl font-black tracking-tight no-underline"
					>
						RowCat
					</Link>
					{/*
					 * The main heading is **what the person is doing now**, not the brand. Both modes share one address, so this line says
					 * which one is showing.
					 */}
					<h1 className="text-lg font-semibold tracking-tight">
						{isSignUp ? t("page.createAccount") : t("page.signIn")}
					</h1>
				</div>

				{/*
				 * One line for someone returning after verification.
				 *
				 * This sentence comes from the **address display**, not server state. That is acceptable because it changes nothing: an
				 * unverified account is still blocked by the form below, and then the verification panel appears again.
				 *
				 * Not drawn while the verification-pending panel is showing; otherwise two sentences would say opposite things on the same screen.
				 */}
				{search.verified && !awaitingVerification && (
					<p className="mt-4 rounded-lg border border-dashed px-3 py-2 text-center text-sm text-muted-foreground">
						{t("page.verified")}
					</p>
				)}

				{/*
				 * One line for someone returning after a reset, in the same place and with the same role as the verification line above.
				 *
				 * "Signed out on other devices" is said again here because that fact can look like something the person did not do (a
				 * phone suddenly showing the sign-in screen). The reset screen and the mail already said it, but this is the first place
				 * they meet its result.
				 */}
				{search.reset && !awaitingVerification && (
					<p className="mt-4 rounded-lg border border-dashed px-3 py-2 text-center text-sm text-muted-foreground">
						{t("page.passwordReset")}
					</p>
				)}

				{/*
				 * A failure that came back **after going through a provider**.
				 *
				 * Same place as the verification line above, but a different character: that one is a good outcome and a quiet gray; this
				 * one is an unmet goal and has a voice (`role="alert"` is provided by `output`'s default role).
				 *
				 * **It is a separate slot from `socialError`.** That one is a failure that never left the page; this one is a failure that
				 * left and came back. Putting both in one slot would mean reviving a state that disappeared while the browser was away at
				 * the provider.
				 *
				 * Not drawn while the verification-pending panel is showing, for the same reason as above.
				 */}
				{search.authError && !awaitingVerification && (
					<output className="mt-4 block rounded-lg border border-destructive/40 px-3 py-2 text-center text-sm text-destructive">
						{socialCallbackErrorMessage(search.provider, search.error)}
					</output>
				)}

				{/*
				 * Credentials and social methods sit inside one panel. They all reach the same outcomes, so putting each in its own box
				 * would make them look like different things. There is exactly one panel, so no second Card goes inside it.
				 */}
				<div className="mt-6 flex flex-col gap-5 rounded-xl border bg-card p-5 sm:p-6">
					{awaitingTwoFactor ? (
						<TwoFactorChallenge
							onAuthenticated={handleAuthenticated}
							onRestart={(notice) => {
								setAwaitingTwoFactor(false);
								setRestartNotice(notice ?? null);
							}}
						/>
					) : awaitingVerification ? (
						<VerificationNotice
							email={awaitingVerification.email}
							mode={awaitingVerification.mode}
							returnPath={redirectTarget}
							onBack={() => setAwaitingVerification(null)}
						/>
					) : (
						<>
							{restartNotice !== null && (
								<output className="block text-sm text-muted-foreground">
									{restartNotice}
								</output>
							)}
							<CredentialsForm
								/*
								 * When the mode changes, the form is recreated. Reusing the instance would leave values and
								 * errors typed on sign-in sitting on the sign-up screen.
								 */
								key={isSignUp ? "signup" : "signin"}
								mode={isSignUp ? "signup" : "signin"}
								/*
								 * The destination is passed to the form too. The `callbackURL` of `sign-in/email` is the
								 * arrival point of a successful sign-in, so omitting it here would drop `?redirect=` for
								 * email sign-in alone (see the header of `email-verification.ts`).
								 */
								returnPath={redirectTarget}
								passwordResetAvailable={passwordResetAvailable}
								pending={pending}
								onPendingChange={setPending}
								onAuthenticated={handleAuthenticated}
								onVerificationRequired={setAwaitingVerification}
								onTwoFactorRequired={() => {
									setRestartNotice(null);
									setAwaitingTwoFactor(true);
								}}
							/>

							{/* Decorative: a divider between the two methods, not content to read. */}
							<div className="flex items-center gap-3" aria-hidden="true">
								<span className="h-px flex-1 bg-border" />
								<span className="text-xs text-muted-foreground">
									{t("page.or")}
								</span>
								<span className="h-px flex-1 bg-border" />
							</div>

							{/*
							 * Social buttons: one list sets the order and the count.
							 *
							 * The two buttons having **the same look** is deliberate too. Drawing one larger or filling its color would read it as the
							 * recommended method, while on this screen all three are the same tier of path to the same result.
							 */}
							<div className="flex flex-col gap-2">
								{SOCIAL_PROVIDERS.map((provider) => (
									<Button
										key={provider}
										type="button"
										variant="outline"
										size="lg"
										disabled={pending !== null}
										onClick={() => handleSocial(provider)}
									>
										<Mark provider={provider} />
										{pending === provider
											? t("social.redirecting", {
													provider: socialProviderLabel(provider),
												})
											: t("social.continue", {
													provider: socialProviderLabel(provider),
												})}
									</Button>
								))}
								{/*
								 * Failure is **stated** here, but as a toast, not below this line.
								 *
								 * For a while this spot swallowed failures silently (`.catch(() => setPending(null))`), and later drew small print under
								 * the button. Both were reported with the same symptom: "I pressed it and nothing happened." The action was meant to leave
								 * the page, so the eye had already left this card, and the sentence therefore rises to the **layer** rather than the screen
								 * (`lib/toast.ts`).
								 */}
							</div>

							{/*
							 * Passkey: **drawn only in browsers that support it.**
							 *
							 * Not reserved as a disabled button. In an unsupported browser that would be a false promise of "coming soon", and this
							 * screen already has working paths; those are always drawn regardless of this check.
							 *
							 * Also drawn in sign-up mode. A passkey does **not create accounts** (the server rejects registration without a session),
							 * but for an existing member who landed on the sign-up screen by mistake, this is the fastest path, and success ends on the
							 * same path as sign-in.
							 */}
							{passkeyReady && (
								/*
								 * Failures go to a toast (same reason as the social buttons above: while the browser
								 * ceremony covers the screen, this card is out of sight). Users who cancel on their own
								 * also arrive here, so the copy stays neutral (`passkey-sign-in.ts`).
								 */
								<Button
									type="button"
									variant="ghost"
									size="lg"
									disabled={pending !== null}
									onClick={handlePasskey}
								>
									<KeyRound />
									{pending === "passkey"
										? t("passkey.checking")
										: t("passkey.signIn")}
								</Button>
							)}
						</>
					)}
				</div>

				<p className="mt-5 text-center text-sm text-muted-foreground">
					{isSignUp ? t("page.haveAccount") : t("page.noAccount")}
					{/*
					 * Switching mode is a navigation within the same route. `replace` means back does not bounce between sign-in and sign-up;
					 * it returns to the screen that was there before. The destination is carried along as-is, because switching must not lose
					 * where to return.
					 */}
					<Link
						to="/login"
						search={
							isSignUp
								? { redirect: redirectTarget }
								: { mode: "signup", redirect: redirectTarget }
						}
						replace
						className="font-medium text-foreground underline underline-offset-4"
					>
						{isSignUp ? t("page.signIn") : t("page.signUp")}
					</Link>
				</p>
			</PageEnter>
		</main>
	);
}
