import { space } from "@rowcat/design";
import {
	Button,
	Input,
	LinkButton,
	Notice,
	Screen,
	ScrollScreen,
	Spinner,
	Text,
	useTheme,
} from "@rowcat/ui-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Wordmark } from "../features/shell/wordmark.tsx";
import { TwoFactorPrompt } from "../features/sign-in/two-factor-prompt.tsx";
import {
	authFailureMessage,
	SOCIAL_PROVIDERS,
	socialSignInLabel,
} from "../lib/auth-social.ts";
import { useMobileIdentity } from "../lib/identity.tsx";
import { usePasswordResetLink } from "../lib/password-reset-link.ts";
import { safeMobileReturnPath } from "../lib/return-path.ts";

/**
 * Login. Sign-in and sign-up share one implementation because most of it is common (email and
 * password fields, submit lock, error display, social buttons, autofill semantics); only two fields
 * (nickname, password confirmation) and the call differ, and two copies would drift silently (web's
 * `credentials-form.tsx` made the same call).
 *
 * There are no auth rules here: validation is `auth-credentials.ts` (pure), completion and cache
 * cleanup are `session-transition.ts`, copy is `auth-error.ts` and `auth-social.ts`. This file only
 * knows what to draw and where to go.
 *
 * ## Return path
 *
 * `?redirect=` can come from someone else's link (deep links open under this app's scheme), so it
 * is never used raw. `safeMobileReturnPath` alone decides, and only its output is passed to
 * navigation and the social callback. It is idempotent, so new call sites need no thought; web was
 * burned by assuming "check once here and trust below".
 *
 * ## Shared with the web auth screen
 *
 * ```text
 * shared      brand on top; one card holding the form; input hierarchy; one primary button with
 *             secondary below; failure as a bordered line above the form; muted helper text
 * not shared  the centered floating card (here the screen is the form); hover; focus ring
 * ```
 *
 * `ScrollScreen` already has keyboard avoidance; copying that wiring per screen would eventually
 * leave one screen's last field under the keyboard.
 */

type Mode = "signin" | "signup";

export default function Login() {
	const identity = useMobileIdentity();
	const router = useRouter();
	const params = useLocalSearchParams<{ redirect?: string | string[] }>();

	/**
	 * In-app path to return to after authentication. Always a string: rejected values fold to the
	 * first screen (`safeMobileReturnPath`). An array comes from a deep link carrying the key twice.
	 */
	const returnPath = useMemo(
		() =>
			safeMobileReturnPath(
				Array.isArray(params.redirect) ? params.redirect[0] : params.redirect,
			),
		[params.redirect],
	);

	const theme = useTheme();
	/**
	 * Path for someone who forgot their password: handed to the web (`passwordResetWebUrl` header).
	 * `null` when reset is closed or the deployment has no web origin, and no link is drawn
	 * (`usePasswordResetLink`); a dead link is a dead end for someone who lost their password.
	 */
	const resetUrl = usePasswordResetLink();
	const [mode, setMode] = useState<Mode>("signin");
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [confirmPassword, setConfirmPassword] = useState("");

	const isSignUp = mode === "signup";
	const busy = identity.pending !== null;
	const authenticated = identity.session.phase === "authenticated";

	/**
	 * Leave if this screen is alive while already authenticated (right after success, or entered via
	 * another tab or deep link). `replace` so back does not return to the login screen just passed.
	 *
	 * Watches `authenticated`, not `ready`: the waiting screen while storage opens belongs to the
	 * first screen (which knows `opening`), and waiting for it here would make login act as a waiting
	 * screen, two screens drawing the same state.
	 */
	useEffect(() => {
		if (authenticated) router.replace(returnPath);
	}, [authenticated, returnPath, router]);

	const submit = useCallback(async () => {
		const ok = isSignUp
			? await identity.signUpWithEmail({
					name,
					email,
					password,
					confirmPassword,
				})
			: await identity.signInWithEmail({ email, password });
		/**
		 * No navigation here even on success. The effect above leaves based on session state; a second
		 * path navigating on the success response would move the screen before `/me` has answered.
		 */
		if (ok) {
			setPassword("");
			setConfirmPassword("");
		}
	}, [confirmPassword, email, identity, isSignUp, name, password]);

	const switchMode = useCallback(() => {
		identity.clearFailure();
		setMode((current) => (current === "signin" ? "signup" : "signin"));
		/** Failure does not clear input; only switching mode empties the password fields. */
		setPassword("");
		setConfirmPassword("");
	}, [identity]);

	if (authenticated)
		return (
			<Screen>
				<Spinner />
			</Screen>
		);

	/**
	 * Two-factor challenge: the password was right and there is no session yet. It stands instead of
	 * the form because with both fields on one screen typing the code into the password field is
	 * common. On success the effect above leaves based on the session; expiry, lockout or `Start over`
	 * return to the form (the reason is stated above the form).
	 */
	if (identity.twoFactorPending)
		return (
			<ScrollScreen contentStyle={login.content}>
				<View style={login.brand}>
					<Wordmark size="display" />
				</View>
				<TwoFactorPrompt />
			</ScrollScreen>
		);

	return (
		<ScrollScreen contentStyle={login.content}>
			<View style={login.brand}>
				<Wordmark size="display" />
				<Text accessibilityRole="header" variant="heading">
					{isSignUp ? "sign-up" : "Sign in"}
				</Text>
			</View>

			<View style={login.fields}>
				{isSignUp ? (
					<Input
						label="Nickname"
						value={name}
						onChangeText={setName}
						autoCapitalize="none"
						autoComplete="username"
						editable={!busy}
					/>
				) : null}

				<Input
					label="Email"
					value={email}
					onChangeText={setEmail}
					autoCapitalize="none"
					autoCorrect={false}
					autoComplete="email"
					keyboardType="email-address"
					inputMode="email"
					editable={!busy}
				/>

				<Input
					label="Password"
					value={password}
					onChangeText={setPassword}
					secureTextEntry
					autoCapitalize="none"
					autoCorrect={false}
					/**
					 * `new-password` on sign-up signals the password manager to suggest a new value instead of
					 * filling a saved one.
					 */
					autoComplete={isSignUp ? "new-password" : "current-password"}
					editable={!busy}
				/>

				{/**
				 * Only in sign-in mode; someone signing up has no password to forget. The typed email is not
				 * passed along: in the address it would land in history and access logs, and retyping on the web
				 * is cheaper (the web's same link does not carry it either).
				 */}
				{!isSignUp && resetUrl ? (
					<View style={login.forgot}>
						<LinkButton
							label="Forgot your password?"
							onPress={() => void WebBrowser.openBrowserAsync(resetUrl)}
							disabled={busy}
						>
							<Text variant="label" tone="muted-foreground">
								Forgot your password?
							</Text>
						</LinkButton>
					</View>
				) : null}

				{isSignUp ? (
					<Input
						label="Confirm password"
						value={confirmPassword}
						onChangeText={setConfirmPassword}
						secureTextEntry
						autoCapitalize="none"
						autoCorrect={false}
						autoComplete="new-password"
						editable={!busy}
					/>
				) : null}
			</View>

			{/**
			 * Failure is a bordered line and interrupts the screen reader (`Notice`'s `destructive` sets
			 * `role="alert"`). No cause string arrives; copy is only the named reasons of `auth-error.ts`.
			 */}
			{identity.failure ? (
				<Notice
					tone="destructive"
					message={authFailureMessage(identity.failure)}
				/>
			) : null}

			<View style={login.actions}>
				<Button
					label={isSignUp ? "Sign up" : "Sign in"}
					fullWidth
					onPress={() => void submit()}
					busy={
						identity.pending === "sign-in" || identity.pending === "sign-up"
					}
					disabled={busy}
				/>
				{/**
				 * Boundary between credentials and social methods. Web's login puts the same rule in the same
				 * place; without it the four buttons read as one group and email and social sign-in look like
				 * steps of one procedure. It is a picture, not content, so it is hidden from the accessibility tree.
				 */}
				<View
					accessible={false}
					accessibilityElementsHidden
					importantForAccessibility="no-hide-descendants"
					style={login.divider}
				>
					<View
						style={[
							login.dividerRule,
							{ backgroundColor: theme.colors.border },
						]}
					/>
					<Text variant="caption" tone="muted-foreground">
						or
					</Text>
					<View
						style={[
							login.dividerRule,
							{ backgroundColor: theme.colors.border },
						]}
					/>
				</View>
				{/**
				 * Social buttons: one list decides count and order (`SOCIAL_PROVIDERS`). Written by hand, one would
				 * miss the pending state or pass a different callback path, visible only to people using that
				 * method (it surfaced when web added Apple).
				 *
				 * Both go through the same completion (`completeAuthentication`); no separate navigation or cache
				 * work here is the whole of that guarantee. They are all `outline` and the same shape, as on web:
				 * making one larger or filled would read as the recommended method, while here they are equal
				 * routes to the same result. The mark goes in as `brand`, whose vocabulary is split from `IconName`
				 * (`brand-mark.tsx` in `@rowcat/ui-native`), so adding a provider with no mark breaks compilation here.
				 */}
				{SOCIAL_PROVIDERS.map((provider) => (
					<Button
						key={provider}
						label={socialSignInLabel(provider, identity.pending === provider)}
						brand={provider}
						variant="outline"
						fullWidth
						/**
						 * The callback is built from the validated path. A raw value would make that link a phishing
						 * route; Better Auth's Expo client turns it into an app deep link for the provider.
						 */
						onPress={() => void identity.signInWithSocial(provider, returnPath)}
						busy={identity.pending === provider}
						disabled={busy}
					/>
				))}
			</View>

			{/**
			 * Mode switch is a link: as a third button it would read as three primary actions, one of which
			 * submits nothing.
			 */}
			<View style={login.switch}>
				{/**
				 * Web sets one distinct word inside a muted sentence as the link (`text-muted-foreground` +
				 * `font-medium text-foreground underline`). Here it was entirely 12px underlined muted text, which
				 * made the second most important control read as a footnote with an equally small target, so people
				 * signing up missed the entry. The accessible name stays in `label` (a sentence, so the spoken name
				 * and the drawn text may differ).
				 */}
				<LinkButton
					label={
						isSignUp
							? "Already have an account?"
							: "Don't have an account? Sign up"
					}
					onPress={switchMode}
					disabled={busy}
				>
					<Text variant="label" tone="muted-foreground">
						{isSignUp ? "Already have an account? " : "Don't have an account? "}
						<Text variant="label" weight="semibold" style={login.switchLink}>
							{isSignUp ? "Sign in" : "Sign up"}
						</Text>
					</Text>
				</LinkButton>
			</View>

			{/**
			 * No `rememberMe` checkbox: web has one but this app cannot keep that promise. This deployment's
			 * Better Auth sends a non-expiring session cookie for `rememberMe: false` (no `Max-Age`), and the
			 * Expo client's cookie store only discards entries whose expiry has passed, so the value stays in
			 * SecureStore. A toggle that says off while remembering is worse than none. See `README.md`.
			 */}
		</ScrollScreen>
	);
}

const login = StyleSheet.create({
	/** A top-to-bottom screen, so the form starts at the top rather than the center. */
	content: { gap: space.xl },
	brand: { gap: space.sm },
	fields: { gap: space.md },
	actions: { gap: space.sm },
	divider: { alignItems: "center", flexDirection: "row", gap: space.md },
	/** 1px rule; `space.px` is that value, so it sits on the scale. */
	dividerRule: { flex: 1, height: space.px },
	switchLink: { textDecorationLine: "underline" },
	switch: { alignItems: "center" },
	/** Right under the password field, where web puts the same link. */
	forgot: { alignItems: "flex-end" },
});
