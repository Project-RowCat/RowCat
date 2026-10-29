/**
 * Copy for the membership gate. No rules live here.
 *
 * The decisions are in `membership-gate-state.ts` (pure). This file holds only Korean text. The
 * web's gate screens say the same facts in their own sentences, since a shared Korean-language
 * package would tie the rules to a locale.
 *
 * ## What PIPA requires for children under 14 is set by statute
 *
 * PIPA article 22-2(3) requires notices to children under 14 to use an easy-to-understand format
 * and clear, plain language. That is why the guardian screen's sentences are shorter and softer
 * than the others. It comes from the statute, not from taste.
 *
 * ## Never framed as a rejection
 *
 * No age or guardian screen says "you cannot sign up". Such a sentence sends the child back to edit
 * their age, and at that point both the chance to identify a child and the protection are lost.
 */

export const AGE_TITLE = "Tell us your date of birth";

/**
 * The screen states that the birth date is not stored. If it does not say what is kept, people
 * assume the worst, and that assumption is usually right.
 */
export const AGE_DESCRIPTION =
	"Members under 14 need a guardian's consent, so we ask this once. RowCat doesn't store your date of birth; it records only whether you're under 14 and the date you turn 14.";

export const AGE_FIELD_LABEL = "Date of birth";
export const AGE_FIELD_PLACEHOLDER = "YYYY-MM-DD";
export const AGE_FIELD_HINT = "e.g. 2011-03-07";
export const AGE_SUBMIT_LABEL = "OK";
export const AGE_SUBMITTING_LABEL = "Checking…";
export const AGE_EMPTY_ERROR = "Please enter your date of birth.";
export const AGE_EXIT_NOTE =
	"Without your date of birth, you can't use the service. You can sign out, or delete your account right from this screen.";

export const GUARDIAN_TITLE = "A guardian's consent is needed";

export const GUARDIAN_DESCRIPTION =
	"If you're under 14, you need consent from a guardian (legal representative) to use RowCat. Send the link below to your guardian. Once they verify their identity and consent, you can start right away.";

/** The child's screen also states what they are consenting to (the intent of PIPA 22-2(3)). */
export const GUARDIAN_STEPS = [
	"Your guardian verifies their identity, for example with a mobile phone.",
	"Your guardian consents to your use of RowCat.",
	"The link works for one day only.",
] as const;

export const GUARDIAN_CREATE_LABEL = "Make a guardian consent link";
export const GUARDIAN_RECREATE_LABEL = "Make the link again";
export const GUARDIAN_CREATING_LABEL = "Creating…";
export const GUARDIAN_LINK_TITLE = "Link to send to your guardian";
export const GUARDIAN_COPY_LABEL = "Copy link";
export const GUARDIAN_COPIED_LABEL = "Copied";
export const GUARDIAN_SHARE_LABEL = "share";
export const GUARDIAN_NEW_LINK_LABEL = "Make a new link";

/**
 * Copy can fail in some contexts, and we say so rather than failing silently. The address is shown
 * on screen, so the honest fallback is "select and copy it yourself". That sentence only makes
 * sense beside the address.
 */
export const GUARDIAN_COPY_FAILED =
	"Couldn't copy. Please select the address above and copy it yourself.";
export const GUARDIAN_SHARE_FAILED = "Couldn't share. Please copy the link.";
export const GUARDIAN_NEW_LINK_NOTE =
	"Making a new link stops the previous one from working.";
export const GUARDIAN_WAITING = "Waiting for your guardian's consent.";

/** Declining is not the end either. If the message is not given, the child reads it as the account being gone. */
export const GUARDIAN_DECLINED =
	"Your guardian didn't consent. You can ask again.";

/**
 * The origin is not configured, so do not guess the address. A dead link is a fault, not guidance,
 * and a child who was handed that link has no way to know why it fails.
 */
export const GUARDIAN_ORIGIN_MISSING =
	"A guardian link can't be made right now. Please try again in a moment.";

export const GUARDIAN_EXIT_NOTE =
	"You can't use the service until your guardian consents. You can sign out, or delete your account right from this screen.";

export const GATE_SIGN_OUT_LABEL = "Sign out";
export const GATE_SIGNING_OUT_LABEL = "Signing out…";
export const GATE_SIGN_OUT_FAILED =
	"Couldn't sign out. Please try again in a moment.";
export const GATE_DELETE_GUIDE_LABEL = "See what gets deleted";
