/**
 * The membership entry gates: age, guardian request and the guardian's consent page (features/onboarding).
 */
export const onboarding = {
	generic: "This can't be done right now. Please try again in a moment.",
	sessionExpired: "Your sign-in has expired. Please sign in again.",
	network: "Couldn't connect. Check your network and try again.",
	age: {
		required: "Please enter your date of birth.",
		invalid:
			"Please check your date of birth. A date after today can't be entered.",
		title: "Tell us your date of birth",
		body: "Members under 14 need a guardian's consent, so we ask this once. RowCat doesn't store your date of birth; it records only whether you're under 14 and the date you turn 14.",
		label: "Date of birth",
		checking: "Checking…",
		confirm: "Confirm",
		exitNote:
			"Without your date of birth, you can't use the service. You can sign out, or delete your account right from this screen.",
	},
	minor: {
		byo: "Members under 14 can't connect a personal API key. Conversations are available with RowCat-provided models.",
		adult: "Members under 14 can't use adult content.",
	},
	guardianRequest: {
		unavailable:
			"The guardian consent process can't start right now. You'll be able to use it once it's ready.",
		notRequired:
			"This account doesn't need guardian consent. Please refresh the page.",
	},
	guardianConsent: {
		notFound:
			"This link is invalid or was already used. Ask your child for a new link.",
		expired: "This link has expired. Ask your child for a new link.",
		alreadyResolved:
			"This request was already handled. Check the status on your child's screen.",
		verificationRequired:
			"Please complete guardian identity verification first.",
		verificationFailed:
			"Identity verification didn't complete. Please try again.",
		notAdult:
			"A legal guardian must be an adult. Please verify in the guardian's own name.",
		verifierUnavailable:
			"Identity verification can't proceed right now. Please try again in a moment.",
		startUnavailable:
			"Identity verification can't start right now. Please try again in a moment.",
		openFailed: "Can't open the consent request",
		invalidLinkTitle: "This link is no longer valid",
		invalidLinkBody:
			"Your child made a new link or the request was cancelled. Ask your child for a new link.",
		title: "Please consent to your child using RowCat",
		agree:
			"I've read the above and consent to my child's use of the service and the processing of their personal information. <muted>(Required)</muted>",
		processing: "Working…",
		approve: "I consent",
		decline: "I don't consent",
		verifyFirst:
			"Guardian identity verification is required first. Under the Personal Information Protection Act, we must confirm the legal guardian consented directly.",
		opening: "Opening…",
		verify: "Verify guardian identity",
		intro:
			"RowCat is a service for reading stories people make and chatting with AI. Children under 14 need a legal guardian's consent to use it.",
		collected:
			"<b>Information collected</b> — sign-in method (email or social account), nickname and service usage records. Your child's date of birth isn't stored; only whether they're under 14 and the date they turn 14 are recorded.",
		guardianInfo:
			"<b>Guardian information</b> — facts confirmed by the identity verification provider (a verification reference, name and contact) are kept only to confirm consent.",
		ai: "<b>AI processing</b> — conversation content is sent to the external AI providers the company contracts with, for generation.",
		limits:
			"<b>Child account limits</b> — adult content and connecting a personal API key aren't available.",
		withdraw:
			"<b>Withdrawing consent</b> — you can withdraw consent or request account deletion at any time through the contact address.",
		validUntil: "This link is valid until {{date}}.",
		approvedTitle: "Consent is complete",
		approvedBody: "Your child can now use RowCat. You can close this window.",
		declinedTitle: "You didn't consent",
		declinedBody:
			"Your child can't use RowCat. If you change your mind later, ask your child to request a new consent link.",
	},
	guardianPanel: {
		title: "A guardian's consent is needed",
		body: "If you're under 14, you need consent from a guardian (legal representative) to use RowCat. Send the link below to your guardian. Once they verify their identity and consent, you can start right away.",
		step1:
			"Your guardian verifies their identity, for example with a mobile phone.",
		step2: "Your guardian consents to your use of RowCat.",
		step3: "The link works for one day only.",
		declined: "Your guardian didn't consent. You can ask again.",
		linkLabel: "Link to send to your guardian",
		copied: "Copied",
		copy: "Copy link",
		newLink: "Make a new link",
		copyFailed:
			"Couldn't copy. Please select the address above and copy it yourself.",
		newLinkNote: "Making a new link stops the previous one from working.",
		creating: "Creating…",
		recreate: "Make the link again",
		create: "Make a guardian consent link",
		waiting: "Waiting for your guardian's consent.",
		exitNote:
			"You can't use the service until your guardian consents. You can sign out, or delete your account right from this screen.",
	},
	gate: {
		signingOut: "Signing out…",
		signOut: "Sign out",
		deletionDetails: "See what gets deleted",
	},
};
