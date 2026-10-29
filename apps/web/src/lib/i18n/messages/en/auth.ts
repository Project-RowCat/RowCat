/**
 * Sign-in, sign-up, verification, password reset and two-factor screens (features/auth).
 */
export const auth = {
	rateLimited: "Too many requests. Please try again in a moment.",
	emailTaken: "This email is already in use.",
	passwordTooShort: "A password must be at least {{min}} characters.",
	passwordTooLong: "A password must be at most {{max}} characters.",
	invalidEmail: "That email address isn't valid.",
	signinTransport: "Couldn't process the sign-in request. Please try again.",
	signupTransport: "Couldn't process the sign-up request. Please try again.",
	emailNotVerified:
		"Your email needs to be verified. Open the verification email in your inbox.",
	invalidCredentials: "The email or password is incorrect.",
	signupFailed: "Couldn't sign up. Please try again in a moment.",
	signOutFailed:
		"Couldn't sign out. You're still signed in, so please try again.",
	nameRequired: "Please enter a name.",
	emailRequired: "Please enter an email.",
	passwordRequired: "Please enter a password.",
	newPasswordRequired: "Please enter a new password.",
	passwordMismatch: "The passwords don't match.",
	social: {
		kakao: "Kakao",
		startTransport:
			"Couldn't start {{provider}} sign-in. Check your connection and try again.",
		startFailed:
			"Couldn't start {{provider}} sign-in. Sign in another way or try again in a moment.",
		emailConsentProvider:
			"You need to agree to share your {{provider}} account's email to sign in. Try again and agree to the email item.",
		emailConsent:
			"You need to agree to share your email to sign in. Try again and agree to the email item.",
		notLinkedProvider:
			"The RowCat account for this email isn't linked to {{provider}} sign-in yet. Sign in the way you used before, then link {{provider}} sign-in on the account screen.",
		notLinked:
			"The RowCat account for this email isn't linked to this sign-in method yet. Sign in the way you used before, then link it on the account screen.",
		emailMismatch:
			"Couldn't sign in because the email differs from the existing RowCat account. Sign in the way you first signed up.",
		alreadyLinkedProvider:
			"This {{provider}} account is already linked to another RowCat account. Accounts can't be merged.",
		alreadyLinked:
			"This account is already linked to another RowCat account. Accounts can't be merged.",
		incompleteProvider:
			"{{provider}} sign-in didn't complete. Try again or sign in another way.",
		incomplete: "Sign-in didn't complete. Try again or sign in another way.",
		redirecting: "Going to {{provider}}…",
		continue: "Continue with {{provider}}",
	},
	passkey: {
		transport:
			"Couldn't process passkey sign-in. Check your connection and try again.",
		failed:
			"Couldn't sign in with a passkey. Please use another sign-in method.",
		checking: "Checking your passkey…",
		signIn: "Sign in with a passkey",
	},
	verification: {
		resendTransport:
			"Couldn't resend the email. Check your connection and try again.",
		alreadyVerified: "This email is already verified. Go ahead and sign in.",
		resendFailed: "Couldn't resend the email. Please try again in a moment.",
		title: "Please verify your email",
		created:
			"Your account was created. We sent a verification email to the address below.",
		notVerified:
			"This account's email isn't verified yet. We sent the verification email again.",
		body: "Open the link in the email to finish verifying, then you can sign in. The link expires after a while.",
		sending: "Sending…",
		resendIn: "Resend (",
		seconds: "s)",
		resend: "Resend verification email",
		resent: "We sent the verification email again.",
		wrongAddress: "Wrong address? Start over",
	},
	form: {
		name: "Name",
		email: "Email",
		password: "Password",
		confirmPassword: "Confirm password",
		hidePassword: "Hide password",
		showPassword: "Show password",
		remember: "Keep me signed in",
		forgot: "Forgot your password?",
		signUp: "Sign up",
		signingUp: "Signing up…",
		signIn: "Sign in",
		signingIn: "Signing in…",
	},
	page: {
		createAccount: "Create an account",
		signIn: "Sign in",
		verified: "Your email is verified. You can sign in now.",
		passwordReset:
			"Your password was changed. You've been signed out on all other devices; sign in with your new password.",
		or: "or",
		haveAccount: "Already have an account? ",
		noAccount: "Don't have an account? ",
		signUp: "Sign up",
	},
	reset: {
		title: "Reset password",
		remembered: "Remembered your password?",
		signIn: "Sign in",
		expiredTitle: "Please get a new link",
		forgotTitle: "Forgot your password?",
		expiredBody:
			"The reset link has expired or was already used. Enter the email you signed up with and we'll send a new link.",
		forgotBody:
			"Enter the email you signed up with and we'll send a link to set a new password.",
		email: "Email",
		sending: "Sending…",
		send: "Get a reset link",
		sentTitle: "Check your inbox",
		sentBody:
			"If an account is registered to the address below, we sent a password reset link.",
		sentNote:
			"The link can be used once within 1 hour. If you don't see the email, check your spam folder too.",
		wrongAddress: "Wrong address? Enter it again",
		newTitle: "Set a new password",
		newBody:
			"Once changed, you'll be signed out on every device that was signed in to this account.",
		newPassword: "New password",
		confirmNewPassword: "Confirm new password",
		changing: "Changing…",
		change: "Change password",
		emailRequired: "Please enter an email.",
		requestTransport:
			"Couldn't send the request. Check your connection and try again.",
		disabled:
			"Password reset emails can't be sent right now. Please sign in another way.",
		requestFailed:
			"Couldn't process the request. Please try again in a moment.",
		changeTransport:
			"Couldn't change the password. Check your connection and try again.",
		changeFailed: "Couldn't change the password. Please try again in a moment.",
	},
	twoFactor: {
		title: "Two-factor authentication",
		authenticatorPrompt:
			"Enter the six-digit code shown in your authenticator app.",
		backupPrompt:
			"Enter one of the backup codes you saved. A used code can't be used again.",
		authenticatorLabel: "Authentication code",
		backupLabel: "Backup code",
		checking: "Checking…",
		confirm: "Confirm",
		useBackup: "Can't use your authenticator app? Sign in with a backup code",
		useAuthenticator: "Sign in with an authenticator app code",
		restart: "Start sign-in over",
		disconnected: "The connection dropped. Please try again.",
		expired: "The verification window has passed. Please start sign-in over.",
		locked:
			"Too many wrong attempts; it's locked for a while. Please start sign-in over shortly.",
		backupInvalid: "That backup code is wrong or was already used.",
		codeInvalid:
			"The code is wrong. Enter the current code from your authenticator app.",
		recentLogin:
			"For security, this can only be changed on a device that signed in recently. Sign in again and try.",
		passwordInvalid: "The password is incorrect.",
		otherFailed: "Couldn't complete it. Please try again in a moment.",
	},
};
