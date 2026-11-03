/**
 * Sign-in: the login screen, the two-factor prompt and the failure sentences. `failure` is keyed by
 * `AuthFailure` (`lib/auth-error.ts`), and that file checks this group covers every value.
 */
export const signIn = {
	login: {
		signInTitle: "Sign in",
		signUpTitle: "Sign up",
		nickname: "Nickname",
		email: "Email",
		password: "Password",
		confirmPassword: "Confirm password",
		forgot: "Forgot your password?",
		signIn: "Sign in",
		signUp: "Sign up",
		or: "or",
		haveAccount: "Already have an account? ",
		noAccount: "Don't have an account? ",
		haveAccountLabel: "Already have an account? Sign in",
		noAccountLabel: "Don't have an account? Sign up",
	},
	twoFactor: {
		title: "Two-factor authentication",
		authenticatorPrompt:
			"Enter the six-digit code shown in your authenticator app.",
		backupPrompt:
			"Enter one of the backup codes you saved. A used code can't be used again.",
		authenticatorLabel: "Authentication code",
		backupLabel: "Backup code",
		useBackupLabel: "Sign in with a backup code",
		useBackup: "Can't use your authenticator app? Sign in with a backup code",
		useAuthenticator: "Sign in with an authenticator app code",
		restart: "Start sign-in over",
	},
	social: {
		continue: "Continue with {{provider}}",
		redirecting: "Going to {{provider}}…",
		providerUnavailable: "{{provider}} sign-in isn't available right now.",
		incomplete:
			"{{provider}} sign-in didn't complete. Try again, or if you've signed up with this email before, sign in with your email.",
	},
	failure: {
		invalid_credentials: "Please check your email or password.",
		email_taken: "This email is already in use.",
		invalid_email: "Please check your email address.",
		password_too_short: "Passwords must be at least 8 characters.",
		password_too_long: "The password is too long.",
		password_mismatch: "The passwords don't match.",
		name_required: "Please enter a nickname.",
		too_many_attempts: "Please try again in a moment.",
		provider_unavailable: "You can't sign in this way right now.",
		social_without_session:
			"Sign-in didn't complete. Try again, or if you've signed up with this email before, sign in with your email.",
		unreachable: "Couldn't reach the server. Please try again in a moment.",
		email_not_verified:
			"Your email needs to be verified. Open the verification email in your inbox.",
		session_without_viewer: "Couldn't sign in. Please try again.",
		sign_out_failed: "Couldn't sign out. Please try again.",
		two_factor_invalid_code:
			"The code is wrong. Enter the current code from your authenticator app.",
		two_factor_invalid_backup_code:
			"That backup code is wrong or was already used.",
		two_factor_expired:
			"The verification window has passed. Please start sign-in over.",
		two_factor_locked:
			"Too many wrong attempts; it's locked for a while. Please start sign-in over shortly.",
		unknown: "Couldn't sign in. Please try again.",
	},
};
