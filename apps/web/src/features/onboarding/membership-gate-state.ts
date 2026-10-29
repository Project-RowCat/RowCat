import { GUARDIAN_ERROR_CODE, MEMBERSHIP_ERROR_CODE } from "@rowcat/contracts";
import type { MembershipGate, Viewer } from "@rowcat/domain";
import { isRowCatApiError } from "@rowcat/sdk";
import { translator } from "#/lib/i18n/current.ts";

/**
 * File header for membership-gate-state.ts: which screen the gate shows, and the copy for failures.
 *
 * Priority is not restated here. The order (age, then guardian consent) is set by the domain's
 * resolveMembershipGate, which runs on the server. The screen reads one value. Rebuilding the order
 * from ageStatus would create a copy that goes stale during a rollout.
 *
 * A failed /me resolves to null, which passes. A trapped user has no way out, so one transient
 * session failure should not lock every member on the age screen. A gate that appears a few seconds
 * late is the lesser harm.
 */
export function membershipGateFor(viewer: Viewer | null): MembershipGate {
	return viewer?.membershipGate ?? null;
}

/**
 * The screen's name for the gate standing now. Guests and /me failures both return null, as in
 * membershipGateFor.
 */
export type AppGate = "age" | "guardian";

export function appGateFor(viewer: Viewer | null): AppGate | null {
	switch (membershipGateFor(viewer)) {
		case "age_required":
			return "age";
		case "guardian_consent_required":
			return "guardian";
		default:
			return null;
	}
}

/**
 * Error codes map to sentences, and only codes decide. The server's message is not drawn directly,
 * for the same reason as auth failure copy: the server can change that string with a deployment.
 * What this screen must distinguish is the reason (the code), because the next step differs per
 * screen. Some guidance here is more specific than the server's own text (see verifierUnavailable).
 *
 * Unknown codes fall back to a generic sentence, so a new failure never leaves the screen blank or
 * shows developer text.
 */
const generic = (): string => translator("onboarding")("generic");

const codeOf = (error: unknown): string | null =>
	isRowCatApiError(error) ? error.code : null;

/**
 * The server returns the reason as a field message (invalid_input), but that sentence only says
 * which field is wrong. It is translated here into this screen's words. Reasons are not split more
 * finely, because the only action on this screen is to correct the value and submit again.
 */
export function ageDeclarationError(error: unknown): string | null {
	if (!error) return null;
	const code = codeOf(error);
	if (code === "invalid_input") return translator("onboarding")("age.invalid");
	if (code === "login_required")
		return translator("onboarding")("sessionExpired");
	return generic();
}

/**
 * verifierUnavailable is separated in this table, and that is the point. It means nothing the user
 * does will work right now. 'Try again' would make the child press until it works. Stating that our
 * side is not ready is more honest, and the next step (contacting support) is different.
 */
export function guardianRequestError(error: unknown): string | null {
	if (!error) return null;
	switch (codeOf(error)) {
		case GUARDIAN_ERROR_CODE.verifierUnavailable:
			return translator("onboarding")("guardianRequest.unavailable");
		case GUARDIAN_ERROR_CODE.notRequired:
			return translator("onboarding")("guardianRequest.notRequired");
		case "login_required":
			return translator("onboarding")("sessionExpired");
		default:
			return generic();
	}
}

/**
 * The guardian screen's failures split into four cases. Folding them into 'an error occurred' is
 * the purpose of this function, because each case needs a different action:
 * - expired or not found: the child must obtain a new link
 * - already processed: nothing to do, or the child has already made a new link
 * - verification failed: retrying works
 * - not ready: nothing can be done right now
 *
 * The first case matters most. A generic error would send the guardian to check their device and
 * authentication method, when they need one button press on the child's screen.
 */
export function guardianConsentError(error: unknown): string | null {
	if (!error) return null;
	switch (codeOf(error)) {
		case GUARDIAN_ERROR_CODE.notFound:
			return translator("onboarding")("guardianConsent.notFound");
		case GUARDIAN_ERROR_CODE.expired:
			return translator("onboarding")("guardianConsent.expired");
		case GUARDIAN_ERROR_CODE.alreadyResolved:
			return translator("onboarding")("guardianConsent.alreadyResolved");
		case GUARDIAN_ERROR_CODE.verificationRequired:
			return translator("onboarding")("guardianConsent.verificationRequired");
		case GUARDIAN_ERROR_CODE.verificationFailed:
			return translator("onboarding")("guardianConsent.verificationFailed");
		case GUARDIAN_ERROR_CODE.verifierNotAdult:
			return translator("onboarding")("guardianConsent.notAdult");
		case GUARDIAN_ERROR_CODE.verifierUnavailable:
			return translator("onboarding")("guardianConsent.verifierUnavailable");
		default:
			/**
			 * Network failures arrive here, not as RowCatApiError. They are kept apart from the sentences
			 * above, which all explain our state. A network failure is a connection problem, and the
			 * guardian's next step differs.
			 */
			return codeOf(error) ? generic() : translator("onboarding")("network");
	}
}

/**
 * Failure sentences for actions blocked by the minor restriction. The two capabilities get
 * different sentences. Sometimes the screen builds this sentence from a server response: when the
 * API is called directly, or when age is confirmed in another tab. Folding it into 'no permission'
 * would make the user read their account as sanctioned. It is not a sanction. It is a feature scope
 * set by age.
 */
export function minorRestrictionMessage(error: unknown): string | null {
	switch (codeOf(error)) {
		case MEMBERSHIP_ERROR_CODE.minorByoRestricted:
			return translator("onboarding")("minor.byo");
		case MEMBERSHIP_ERROR_CODE.minorAdultRestricted:
			return translator("onboarding")("minor.adult");
		default:
			return null;
	}
}
