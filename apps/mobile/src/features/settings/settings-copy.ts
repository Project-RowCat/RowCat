/**
 * Copy for the settings screen. **No decisions live here.**
 *
 * It sits in the same place, with the same rule, as the account screen (`account-copy.ts`). The
 * guest and unconfirmed sentences differ from the web's equivalents for one reason: this app has no
 * "browser".
 */

/** Guest — **does not bounce to sign-in.** It first explains why nothing can be seen. */
export const SETTINGS_GUEST = {
	title: "Sign-in required",
	description:
		"Theme colors, generation defaults and personas are stored on your account and this device. Screen brightness can be changed from the header even without signing in.",
	action: "Sign in",
} as const;

/**
 * The session cannot be checked — **this is not a sign-out.** The stored session is unchanged; we
 * simply could not ask. All that can be done here is ask again, not sign in.
 */
export const SETTINGS_UNAVAILABLE =
	"Couldn't check your session. Please try again in a moment.";

export const SETTINGS_RETRY_LABEL = "Try again";
