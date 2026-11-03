/**
 * The membership gate (features/onboarding: date of birth and guardian consent) and adult
 * verification (features/adult-verification). The Korean uses the web's words (`apps/web`
 * `onboarding` and `account.adultVerification*`).
 *
 * The ages are `{{guardianAge}}` and `{{adultAge}}`, filled from the deployment's numbers at
 * translation time (`lib/membership-ages.ts`, the instance's default variables) — never a literal.
 *
 * The guardian panel's sentences are shorter and softer than the rest because PIPA article 22-2(3)
 * requires plain language in notices to children under the consent age; that comes from the
 * statute, not from taste. No gate sentence says "you cannot sign up": that sends a child back to
 * edit their age, and both the chance to identify a child and the protection are lost.
 */
export const membership = {
	generic: "This can't be done right now. Please try again in a moment.",
	offline: "Couldn't send the request. Please check your connection.",
	sessionExpired: "Your sign-in has expired. Please sign in again.",
	age: {
		title: "Tell us your date of birth",
		/** States what is kept: if it does not, people assume the worst, and that assumption is usually right. */
		description:
			"Members under {{guardianAge}} need a guardian's consent, so we ask this once. RowCat doesn't store your date of birth; it records only whether you're under {{guardianAge}} and the date you turn {{guardianAge}}.",
		fieldLabel: "Date of birth",
		placeholder: "YYYY-MM-DD",
		hint: "e.g. 2011-03-07",
		submit: "OK",
		submitting: "Checking…",
		empty: "Please enter your date of birth.",
		invalid:
			"Please check your date of birth. A date after today can't be entered.",
		exitNote:
			"Without your date of birth, you can't use the service. You can sign out, or delete your account right from this screen.",
	},
	guardian: {
		title: "A guardian's consent is needed",
		description:
			"If you're under {{guardianAge}}, you need consent from a guardian (legal representative) to use RowCat. Send the link below to your guardian. Once they verify their identity and consent, you can start right away.",
		/** The child's screen also states what they are consenting to (the intent of PIPA 22-2(3)). */
		steps: {
			verify:
				"Your guardian verifies their identity, for example with a mobile phone.",
			consent: "Your guardian consents to your use of RowCat.",
			expiry: "The link works for one day only.",
		},
		create: "Make a guardian consent link",
		recreate: "Make the link again",
		creating: "Creating…",
		linkTitle: "Link to send to your guardian",
		copy: "Copy link",
		copied: "Copied",
		share: "share",
		newLink: "Make a new link",
		/** The address is on screen, so the honest fallback is "copy it yourself", beside the address. */
		copyFailed:
			"Couldn't copy. Please select the address above and copy it yourself.",
		shareFailed: "Couldn't share. Please copy the link.",
		newLinkNote: "Making a new link stops the previous one from working.",
		waiting: "Waiting for your guardian's consent.",
		/** Declining is not the end either; without this the child reads it as the account being gone. */
		declined: "Your guardian didn't consent. You can ask again.",
		/** The origin is not configured, so the address is not guessed: a dead link is a fault, not guidance. */
		originMissing:
			"A guardian link can't be made right now. Please try again in a moment.",
		exitNote:
			"You can't use the service until your guardian consents. You can sign out, or delete your account right from this screen.",
		/** Nothing the user does will work right now; "try again" would make a child press until it works. */
		unavailable:
			"Guardian consent can't be started right now. You'll be able to use it once it's ready.",
		notRequired:
			"This account doesn't need guardian consent. Please reopen the screen.",
	},
	gate: {
		signOut: "Sign out",
		signingOut: "Signing out…",
		signOutFailed: "Couldn't sign out. Please try again in a moment.",
		deleteGuide: "See what gets deleted",
	},
	/**
	 * Adult verification opens entitlement, not display: no sentence promotes adult content. Provider
	 * messages are never drawn — the sentences are ours.
	 */
	adult: {
		verify: "Verify identity",
		/** Re-verification for someone verified as under the adult age, not a retry of a broken check. */
		reverify: "Verify again",
		renewTitle: "It's been a year since identity verification.",
		renewNote:
			"Verify your identity again to see adult content. Until then, adult stories stay hidden even with the display on.",
		busy: {
			beginning: "Opening…",
			provider: "In progress in the verification window…",
			completing: "Checking…",
		},
		surfaceTitle: "Verify identity",
		/** Closing is a cancel, not a failure; without this the close button reads as breaking the check. */
		surfaceNote:
			"You'll come back automatically when verification finishes. Closing cancels without proceeding.",
		done: "Your identity verification was applied.",
		recheck: "Check the result again",
		recheckNote:
			"Verification finished, but the result couldn't be applied. Please check again.",
		onWeb: "Verify on the web",
		onWebNote:
			"Identity verification can't be done in the app right now. Sign in on the web and continue from the account screen.",
		error: {
			unavailable:
				"Identity verification isn't available right now. Please check again in a moment.",
			notFound:
				"No identity verification is in progress. Please start again from the beginning.",
			expired: "The identity verification screen expired. Please start again.",
			notCompleted: "Identity verification didn't complete. Please try again.",
			conflict:
				"Identity verification was carried out somewhere else. Please start over.",
			providerFailed: "Identity verification failed. Please try again.",
			rateLimited:
				"Too many identity verification attempts. Please try again in a moment.",
			minor: "Accounts under {{guardianAge}} can't use adult content.",
			signedOut: "You've been signed out. Please sign in again.",
			failed:
				"Couldn't complete identity verification. Please try again in a moment.",
			surfaceFailed:
				"Couldn't open the verification screen. Please try again in a moment.",
			unsupported:
				"Identity verification can't be done in the app right now. Please continue on the web.",
		},
	},
};
