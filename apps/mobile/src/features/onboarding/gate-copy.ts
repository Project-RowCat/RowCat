import { deferredGroup } from "../../lib/i18n/instance.ts";

/**
 * Copy for the membership gate. No rules live here.
 *
 * The decisions are in `membership-gate-state.ts` (pure). The sentences live in the dictionaries
 * (`membership`, English and Korean); this module names them. The ages inside them are
 * `{{guardianAge}}`, filled from the deployment's number at translation time — this file no longer
 * reads `membershipAges()` itself.
 *
 * ## What PIPA requires for children under the consent age is set by statute
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

/**
 * The age screen: title, the description (it states that the birth date is not stored — if it does
 * not say what is kept, people assume the worst), the field, its button and the exit note.
 */
export const AGE_COPY = deferredGroup("membership", "age");

/**
 * The guardian screen. The child's screen also states what they are consenting to (`steps`, the
 * intent of PIPA 22-2(3)); a declined request is not the end either; and when the web origin is not
 * configured the address is not guessed — a dead link is a fault, not guidance.
 */
export const GUARDIAN_COPY = deferredGroup("membership", "guardian");

/** The steps in the order the guardian takes them. */
export const guardianSteps = (): readonly string[] => [
	GUARDIAN_COPY.steps.verify,
	GUARDIAN_COPY.steps.consent,
	GUARDIAN_COPY.steps.expiry,
];

/** The exits every gate shares: sign out and the deletion guide. */
export const GATE_COPY = deferredGroup("membership", "gate");
