import { Button } from "@rowcat/ui-web/components/button";
import { Checkbox } from "@rowcat/ui-web/components/checkbox";
import { Input } from "@rowcat/ui-web/components/input";
import { Label } from "@rowcat/ui-web/components/label";
import { useForm } from "@tanstack/react-form";
import { Link } from "@tanstack/react-router";
import { Eye, EyeOff } from "lucide-react";
import { AnimatePresence } from "motion/react";
import * as m from "motion/react-m";
import { type ReactNode, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { authClient } from "#/lib/auth.ts";
import { translator } from "#/lib/i18n/current.ts";
import { AnimatedIconSwap } from "#/lib/motion/animated-icon-swap.tsx";
import { feedbackEnter, feedbackExit } from "#/lib/motion/feedback.ts";
import {
	type AuthFailure,
	type AuthMode,
	authErrorMessage,
	isEmailNotVerified,
	logAuthFailure,
	PASSWORD_MAX_LENGTH,
	PASSWORD_MIN_LENGTH,
} from "./auth-error.ts";
import { verificationCallbackUrl } from "./email-verification.ts";
import type { SocialProvider } from "./social-sign-in.ts";
import { isTwoFactorRedirect } from "./two-factor.ts";

/**
 * Email and password form. Sign-in and sign-up share **one implementation**.
 *
 * It is not split into two screens because most of the behaviour is shared: the email field, the
 * password field, show and hide, the submit lock, error display and autocomplete semantics. Only
 * two fields (name and password confirmation) and the Better Auth call differ. Keeping two copies
 * would let the shared part drift silently; someday only one copy would get an `aria-describedby`
 * fix.
 *
 * All field state lives in TanStack Form. Only what exists on this screen alone (whether the
 * password is shown, the submit failure sentence) is React state, because neither is a form value
 * and so neither is submitted or validated.
 */

/**
 * The authentication currently in progress on this screen.
 *
 * It is one slot rather than several booleans. With a progress flag per method, the impossible
 * state "two in progress" becomes representable, and what to lock would differ from call site to
 * call site. With one slot there is one lock rule: if anything is in progress, everything is
 * locked.
 *
 * Importing `SocialProvider` instead of listing the social branches here follows the same axis. If
 * this line had to change whenever a provider is added, someone would forget, and only that button
 * would lack its progress indicator (the type does not block it; the string literal simply fails to
 * match, which surfaces at the call site).
 */
export type AuthPending = "credentials" | SocialProvider | "passkey" | null;

/**
 * All values the form handles. Only some are drawn, depending on the mode.
 *
 * `confirmPassword` is here **for on-screen validation only**. The submit path picks fields one by
 * one, so this value has no route to the server. Not spreading the whole value object is the entire
 * guarantee, which is why it is not spread.
 */
interface CredentialsValues {
	name: string;
	email: string;
	password: string;
	confirmPassword: string;
	rememberMe: boolean;
}

const EMPTY_VALUES: CredentialsValues = {
	name: "",
	email: "",
	password: "",
	confirmPassword: "",
	rememberMe: true,
};

/** Format validation is delegated to zod; a hand-written email regex is wrong in more cases. */
const EmailFormat = z.email();

/**
 * Validators are attached to both `onChange` and `onSubmit` as the **same function**.
 *
 * On submit alone, an error stays until the next submit even after the value is fixed. On change
 * alone, submitting an untouched empty form shows nothing. Attaching both gives "tell me on submit,
 * and clear it once fixed".
 */
const validateName = ({ value }: { value: string }) =>
	value.trim() ? undefined : translator("auth")("nameRequired");

const validateEmail = ({ value }: { value: string }) => {
	const email = value.trim();
	if (!email) return translator("auth")("emailRequired");
	return EmailFormat.safeParse(email).success
		? undefined
		: translator("auth")("invalidEmail");
};

/**
 * Sign-up password. The server (Better Auth) is the final authority; this is a hint that saves a
 * round trip.
 *
 * There are no composition rules such as uppercase or symbols, only length. Composition rules push
 * people toward `Password1!`-style strings, which are worse than long passphrases.
 */
const validateNewPassword = ({ value }: { value: string }) => {
	const t = translator("auth");
	if (!value) return t("passwordRequired");
	if (value.length < PASSWORD_MIN_LENGTH)
		return t("passwordTooShort", { min: PASSWORD_MIN_LENGTH });
	if (value.length > PASSWORD_MAX_LENGTH)
		return t("passwordTooLong", { max: PASSWORD_MAX_LENGTH });
	return undefined;
};

/**
 * The sign-in password is checked for **emptiness only**.
 *
 * A length rule here would do two things wrong: a password created before a policy change (shorter)
 * could not get past the sign-in screen, and a "8 or more characters" message would expose the
 * server policy in the form. Whether the password is correct is the server's answer.
 */
const validateExistingPassword = ({ value }: { value: string }) =>
	value ? undefined : translator("auth")("passwordRequired");

/** Password confirmation. It reads another field of the form, so its shape differs from the single-field validators above. */
const validateConfirm = ({
	value,
	fieldApi,
}: {
	value: string;
	fieldApi: { form: { getFieldValue: (name: "password") => string } };
}) =>
	value === fieldApi.form.getFieldValue("password")
		? undefined
		: translator("auth")("passwordMismatch");

const submitLabel = (isSignUp: boolean, running: boolean): string => {
	const t = translator("auth");
	if (isSignUp) return running ? t("form.signingUp") : t("form.signUp");
	return running ? t("form.signingIn") : t("form.signIn");
};

export function CredentialsForm({
	mode,
	returnPath,
	passwordResetAvailable,
	pending,
	onPendingChange,
	onAuthenticated,
	onVerificationRequired,
	onTwoFactorRequired,
}: {
	mode: AuthMode;
	/**
	 * The internal path of this app to return to after authentication. Absent means the default
	 * destination.
	 *
	 * The form uses this because `sign-in/email`'s `callbackURL` is both the return address of the
	 * verification mail and the **destination of a successful sign-in** (`email-verification.ts`).
	 * Without passing it here, only email sign-in loses `?redirect=`.
	 */
	returnPath?: string;
	/**
	 * Whether this deployment opens password reset (the `passwordReset` value of the public runtime
	 * config).
	 *
	 * A closed deployment draws no link, not even a disabled one. A disabled link is a promise of
	 * "coming soon", and the reason reset is closed (the policy does not yet list that mail) is not a
	 * date-bound promise.
	 */
	passwordResetAvailable: boolean;
	/** The authentication in progress on this screen. The form and the Google and passkey buttons share it. */
	pending: AuthPending;
	onPendingChange: (pending: AuthPending) => void;
	/** A session now exists. What happens next (re-fetching the viewer, navigating) is decided by the screen. */
	onAuthenticated: () => Promise<void>;
	/**
	 * No session was created, and email verification is still pending.
	 *
	 * Sign-up and unverified sign-in both arrive here. They are not reported separately because the
	 * screen does the same thing for both (switch to the verification notice); only the wording
	 * differs, and `mode` decides that.
	 */
	onVerificationRequired: (input: { email: string; mode: AuthMode }) => void;
	/**
	 * The password was correct and a **second factor remains**; there is no session yet.
	 *
	 * The server cleared the session in the meantime and left only the challenge cookie, so calling
	 * `onAuthenticated()` would make `/me` answer guest. The screen switches to the challenge in place
	 * (`two-factor-challenge.tsx`).
	 */
	onTwoFactorRequired: () => void;
}) {
	const { t } = useTranslation("auth");
	const fieldId = useId();
	const errorId = `${fieldId}-error`;
	const [showPassword, setShowPassword] = useState(false);
	const [submitError, setSubmitError] = useState<string | null>(null);
	/**
	 * The final guard against a second submit.
	 *
	 * The button's `disabled` is not enough: it takes effect only from the **next render**, so a very
	 * fast double-click fires the second click before it is blocked. A ref does not wait for a render,
	 * so there is no gap. If sign-up went out twice, the second would return an "email already in use"
	 * error and show a failure to the person who just created the account.
	 */
	const inFlight = useRef(false);

	const isSignUp = mode === "signup";
	const busy = pending !== null;

	const form = useForm({
		defaultValues: EMPTY_VALUES,
		onSubmit: async ({ value }) => {
			if (inFlight.current) return;
			inFlight.current = true;
			setSubmitError(null);
			onPendingChange("credentials");

			// Only the email is trimmed at the ends. The password is left untouched: whitespace is part of
			// the password the user chose, and trimming it here would make sign-in on another device compare
			// a different value.
			const email = value.email.trim();

			try {
				/**
				 * We choose the address the verification link brings the user back to. Passing a value read
				 * from the query would turn the mailed link into a phishing path, far worse than the login
				 * screen's `?redirect=` (the server's `trustedOrigins` filters it once more).
				 */
				const callbackURL = verificationCallbackUrl(returnPath);

				const result = isSignUp
					? await authClient.signUp.email({
							name: value.name.trim(),
							email,
							password: value.password,
							...(callbackURL ? { callbackURL } : {}),
						})
					: await authClient.signIn.email({
							email,
							password: value.password,
							rememberMe: value.rememberMe,
							...(callbackURL ? { callbackURL } : {}),
						});

				if (result.error) {
					const failure: AuthFailure = result.error;
					/**
					 * **Awaiting verification is not a failure.** The password was correct and the account exists,
					 * and the server has resent the verification mail in the meantime. Drawing an error here would
					 * make the user keep retyping a correct password.
					 */
					if (isEmailNotVerified(failure)) {
						onVerificationRequired({ email, mode });
						return;
					}
					logAuthFailure(mode, failure);
					setSubmitError(authErrorMessage(mode, failure));
					return;
				}

				/**
				 * **Some deployments give no session on sign-up.**
				 *
				 * When email ownership verification is required, Better Auth sets the sign-up response's
				 * `token` to `null` and creates no session. Calling `onAuthenticated()` then makes `/me` answer
				 * guest, and the screen moves to the signed-in place only to bounce back out. The user sees
				 * "signed up but could not sign in".
				 *
				 * So the response is read for what it says: with no session, go to the verification notice. The
				 * sign-in response always carries this field, so one check covers both branches.
				 */
				/**
				 * A second-factor challenge comes **only after the password has been verified**, so this branch
				 * does not break existence hiding (it makes the same decision as unverified sign-in). A wrong
				 * password ends with the same sentence above regardless of whether the account uses two-factor
				 * authentication.
				 */
				if (!isSignUp && isTwoFactorRedirect(result.data)) {
					onTwoFactorRequired();
					return;
				}

				const token = (result.data as { token?: string | null } | null)?.token;
				if (isSignUp && !token) {
					onVerificationRequired({ email, mode });
					return;
				}

				/**
				 * The viewer is not built here. Only the fact that a session exists is reported upward; the
				 * product identity is answered by `/me`. If the form started constructing a Viewer, the sign-in
				 * path alone would hold a different identity resolution.
				 */
				await onAuthenticated();
			} catch {
				/**
				 * No response arrived at all (network failure and similar). The caught exception is not drawn:
				 * fetch exception messages carry internal details such as the request URL.
				 */
				const failure: AuthFailure = {};
				logAuthFailure(mode, failure);
				setSubmitError(authErrorMessage(mode, failure));
			} finally {
				inFlight.current = false;
				onPendingChange(null);
			}
		},
	});

	return (
		<form
			/**
			 * **A form submitted before hydration would send the password in the address, so it is `post`.**
			 *
			 * This screen is server-rendered, so the form is clickable from the moment the document arrives.
			 * At that point `onSubmit` is not attached yet, and a form without `method` defaults to **GET**:
			 * the browser puts every named field into the query string and navigates to the same address:
			 *
			 * ```text
			 * /login?email=...%40example.com&password=<plaintext>&rememberMe=on
			 * ```
			 *
			 * That line lands in the address bar, browser history, the SSR access log and reverse-proxy
			 * logs, and in the `Referer` of every subrequest the page makes. It is the most expensive form
			 * of the rule against putting personal data in query strings.
			 *
			 * This is a **reproduced** path, not a hypothetical one (`e2e/journeys/15-login-return-path` hit
			 * it first). No person types that fast, but **password managers do**: they fill the fields as
			 * the page loads and press Enter straight after.
			 *
			 * `post` closes that window. The values travel in the body, and the server returns the same
			 * sign-in screen (200). The user sees "I had to press it once more", and the password never
			 * stays in the address after a silent non-login.
			 *
			 * There is no `action`. Left empty, the form posts to the current address so `?redirect=`
			 * survives; writing a value would add one more place where the string could drift from the
			 * route.
			 */
			method="post"
			// Our own error copy is shown instead of the browser's default bubble. The default bubble's
			// wording cannot be controlled, and browsers read it differently.
			noValidate
			onSubmit={(event) => {
				event.preventDefault();
				void form.handleSubmit();
			}}
			className="flex flex-col gap-4"
		>
			{isSignUp && (
				<form.Field
					name="name"
					validators={{ onChange: validateName, onSubmit: validateName }}
				>
					{(field) => (
						<FormRow
							label={t("form.name")}
							htmlFor={`${fieldId}-name`}
							error={firstError(field.state.meta.errors)}
						>
							<Input
								id={`${fieldId}-name`}
								name="name"
								type="text"
								autoComplete="name"
								disabled={busy}
								aria-invalid={hasError(field.state.meta.errors)}
								aria-describedby={describedBy(
									field.state.meta.errors,
									`${fieldId}-name`,
								)}
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(event) => field.handleChange(event.target.value)}
							/>
						</FormRow>
					)}
				</form.Field>
			)}

			<form.Field
				name="email"
				validators={{ onChange: validateEmail, onSubmit: validateEmail }}
			>
				{(field) => (
					<FormRow
						label={t("form.email")}
						htmlFor={`${fieldId}-email`}
						error={firstError(field.state.meta.errors)}
					>
						<Input
							id={`${fieldId}-email`}
							name="email"
							type="email"
							autoComplete="email"
							// An email is not a proper noun: mobile keyboards capitalise the first letter, and the user
							// would have to delete it every time.
							autoCapitalize="none"
							spellCheck={false}
							disabled={busy}
							aria-invalid={hasError(field.state.meta.errors)}
							aria-describedby={describedBy(
								field.state.meta.errors,
								`${fieldId}-email`,
							)}
							value={field.state.value}
							onBlur={field.handleBlur}
							onChange={(event) => field.handleChange(event.target.value)}
						/>
					</FormRow>
				)}
			</form.Field>

			<form.Field
				name="password"
				validators={
					isSignUp
						? { onChange: validateNewPassword, onSubmit: validateNewPassword }
						: {
								onChange: validateExistingPassword,
								onSubmit: validateExistingPassword,
							}
				}
			>
				{(field) => (
					<FormRow
						label={t("form.password")}
						htmlFor={`${fieldId}-password`}
						error={firstError(field.state.meta.errors)}
					>
						<div className="relative">
							<Input
								id={`${fieldId}-password`}
								name="password"
								type={showPassword ? "text" : "password"}
								// For sign-in this means the saved password; for sign-up, a new one. If this value is
								// wrong, the password manager fills the sign-up form with an existing password, or does not
								// offer to save a newly created password.
								autoComplete={isSignUp ? "new-password" : "current-password"}
								disabled={busy}
								className="pr-10"
								aria-invalid={hasError(field.state.meta.errors)}
								aria-describedby={describedBy(
									field.state.meta.errors,
									`${fieldId}-password`,
								)}
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(event) => field.handleChange(event.target.value)}
							/>
							<Button
								// A button inside a form defaults to submit: without an explicit type, pressing the eye
								// button would submit the form every time.
								type="button"
								variant="ghost"
								size="icon-sm"
								disabled={busy}
								aria-pressed={showPassword}
								aria-label={
									showPassword ? t("form.hidePassword") : t("form.showPassword")
								}
								className="absolute inset-y-0 right-0.5 my-auto text-muted-foreground"
								onClick={() => setShowPassword((shown) => !shown)}
							>
								{/*
								 * The same control changes its own state, so it swaps glyphs rather than using presence. It follows the
								 * same rhythm as the chat composer's `Send ↔ Stop generating` toggle.
								 * The shared helper lives in `lib/motion/icon-swap.ts`.
								 *
								 * State is still announced by `aria-pressed` and `aria-label`, and both change in the **same render**
								 * regardless of this transition. Neither the input itself nor the revealed
								 * password text moves.
								 */}
								<AnimatedIconSwap stateKey={showPassword ? "shown" : "hidden"}>
									{showPassword ? (
										<EyeOff aria-hidden="true" />
									) : (
										<Eye aria-hidden="true" />
									)}
								</AnimatedIconSwap>
							</Button>
						</div>
					</FormRow>
				)}
			</form.Field>

			{isSignUp && (
				<form.Field
					name="confirmPassword"
					validators={{
						// This field must be re-validated when the password changes later; without this, a
						// confirmation matched earlier would stay in a stale "matches" state.
						onChangeListenTo: ["password"],
						onChange: validateConfirm,
						onSubmit: validateConfirm,
					}}
				>
					{(field) => (
						<FormRow
							label={t("form.confirmPassword")}
							htmlFor={`${fieldId}-confirm`}
							error={firstError(field.state.meta.errors)}
						>
							<Input
								id={`${fieldId}-confirm`}
								name="confirmPassword"
								type={showPassword ? "text" : "password"}
								autoComplete="new-password"
								disabled={busy}
								aria-invalid={hasError(field.state.meta.errors)}
								aria-describedby={describedBy(
									field.state.meta.errors,
									`${fieldId}-confirm`,
								)}
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(event) => field.handleChange(event.target.value)}
							/>
						</FormRow>
					)}
				</form.Field>
			)}

			{!isSignUp && (
				<div className="flex items-center justify-between gap-3">
					<form.Field name="rememberMe">
						{(field) => (
							<Label
								htmlFor={`${fieldId}-remember`}
								className="w-fit text-muted-foreground"
							>
								<Checkbox
									id={`${fieldId}-remember`}
									name="rememberMe"
									disabled={busy}
									checked={field.state.value}
									onCheckedChange={(checked) => field.handleChange(checked)}
								/>
								{t("form.remember")}
							</Label>
						)}
					</form.Field>
					{/*
					 * The forgot-password path. It appears **only in sign-in mode** (a person signing up has no
					 * a password to forget). It does not appear at all in a deployment where reset is closed.
					 *
					 * The typed email is not carried. In the query it would land in browser history and access logs,
					 * and retyping it on the reset screen is cheaper. Only the destination (`redirect`) is carried,
					 * the place to continue to after sign-in following a reset.
					 *
					 * While sign-in is in progress it stays as plain text, not a link. If the screen is left while the
					 * sign-in request is out, nothing remains to receive its response.
					 */}
					{!passwordResetAvailable ? null : busy ? (
						<span className="text-sm text-muted-foreground">
							{t("form.forgot")}
						</span>
					) : (
						<Link
							to="/reset-password"
							search={{ redirect: returnPath }}
							className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
						>
							{t("form.forgot")}
						</Link>
					)}
				</div>
			)}

			{/*
			 * Submit failures sit **directly above the button**, not above the form, so the answer is next to what was just pressed.
			 * The live region wraps this because the text appears without a page change;
			 * screen readers do not announce newly drawn text on their own.
			 */}
			<output aria-live="polite" id={errorId} className="empty:hidden">
				{/*
				 * This failure follows a submit, so it arrives with more weight. The live region reads **regardless of motion**
				 * right away; the transition delays only when the text becomes visible,
				 * not when it enters the DOM.
				 */}
				<AnimatePresence initial={false} mode="wait">
					{submitError && (
						<m.span
							key={submitError}
							initial={feedbackEnter.initial}
							animate={feedbackEnter.animate}
							exit={feedbackExit}
							transition={feedbackEnter.transition}
							className="block text-sm text-destructive"
						>
							{submitError}
						</m.span>
					)}
				</AnimatePresence>
			</output>

			{/*
			 * This is the screen's primary action. It has the same height as the Google button, so both routes carry the same weight
			 * (either route yields the same session).
			 */}
			<Button
				type="submit"
				size="lg"
				disabled={busy}
				aria-describedby={submitError ? errorId : undefined}
			>
				{submitLabel(isSignUp, pending === "credentials")}
			</Button>
		</form>
	);
}

/**
 * One unit of label, control and error.
 *
 * Placeholders are not used as labels: they vanish as soon as a value is typed, so when the screen
 * is viewed again the field's purpose is unknown (and to screen readers a placeholder was never a
 * label).
 */
function FormRow({
	label,
	htmlFor,
	error,
	children,
}: {
	label: string;
	htmlFor: string;
	error: string | undefined;
	children: ReactNode;
}) {
	return (
		<div className="flex flex-col gap-1.5">
			<Label htmlFor={htmlFor}>{label}</Label>
			{children}
			{/*
			 * The validation message is **the last flow child of this unit**, so it uses the full rhythm of a sentence that attaches and detaches
			 * in full (`feedback.ts`), and its removal delays no one's layout.
			 *
			 * The rule here is that `key` is the **message text**. Validation runs on every keystroke
			 * (`onChange`); while the same sentence persists the key is unchanged, so nothing happens.
			 * Flickering the message on every letter would make the spot unreadable. In practice
			 * only three transitions run: none → message, message A → message B, and message → none.
			 *
			 * It neither shakes nor animates height. Shaking a wrong field is a punitive gesture,
			 * and height interpolation makes the surrounding layout recalculate throughout typing
			 * (see "Height animation" in `docs/motion/ARCHITECTURE.md`).
			 */}
			<AnimatePresence initial={false} mode="wait">
				{error && (
					<m.p
						key={error}
						id={`${htmlFor}-error`}
						initial={feedbackEnter.initial}
						animate={feedbackEnter.animate}
						exit={feedbackExit}
						transition={feedbackEnter.transition}
						className="text-xs text-destructive"
					>
						{error}
					</m.p>
				)}
			</AnimatePresence>
		</div>
	);
}

/**
 * Reads the validation error.
 *
 * TanStack Form puts whatever a validator returns into an array; we return only strings. The type
 * is wide and needs narrowing somewhere. Narrowing separately in three places would let the
 * displayed message and `aria-invalid` drift apart when only one place is fixed, so the decision
 * lives here alone.
 */
const firstError = (errors: unknown[]): string | undefined =>
	errors.find((error): error is string => typeof error === "string");

const hasError = (errors: unknown[]): boolean =>
	firstError(errors) !== undefined;

/** Linked only when an error exists: pointing at a missing id leaves assistive technology with nothing to read. */
const describedBy = (errors: unknown[], htmlFor: string): string | undefined =>
	hasError(errors) ? `${htmlFor}-error` : undefined;
