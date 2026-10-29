import { GUARDIAN_ERROR_CODE } from "@rowcat/contracts";
import type { MembershipGate, Viewer } from "@rowcat/domain";
import { isRowCatApiError } from "@rowcat/sdk";

/**
 * Which screen the entry gate raises, and which sentence a failure becomes.
 *
 * The decision is kept out of components for the same reason as the other decisions in this app:
 * its tests do not render screens, so the only way to check these by hand is to try them. Getting
 * either direction wrong is loud:
 *
 * ```text
 * too broad   a guest sees the age check instead of the public gallery
 * too narrow  an under-14 member uses the app without guardian consent
 * ```
 *
 * ## The priority is not restated here
 *
 * The order (age → guardian consent) lives in the domain's `resolveMembershipGate` and runs **on
 * the server**. This app reads one value the server computed (`viewer.membershipGate`).
 *
 * `ageStatus` is not used to assemble the gate. Deriving a branch from it creates a second priority
 * algorithm, and that copy would apply stale rules while a deployment is rolling out (the rollout
 * switch decides whether `unknown` raises a gate at all, and only the server reads it).
 *
 * ## A failed lookup does not raise a gate
 *
 * The viewer this function receives is always a **confirmed member** (`session.phase ===
 * "authenticated"`). Guests, booting, and `unavailable` all arrive as `null` and pass through.
 *
 * The direction is deliberate: a trapped person has no way out. A single transient failure of the
 * session lookup trapping **every member** on the age check is worse than the gate appearing a few
 * seconds late. `unavailable` is also not judged against the stale viewer: not being able to ask
 * the server is a different fact from the server answering, and a gate drawn from the previous
 * state is a claim we cannot verify right now. A member who really needs the gate gets it the
 * moment the next lookup succeeds.
 */

/** The screen of the gate currently raised: one of the two, or none. */
export type AppGate = "age" | "guardian";

/**
 * Server vocabulary → this app's screen. **A table, so a new server value breaks compilation.**
 *
 * It is not written as `switch` + `default: return null` because in that shape a new
 * `MembershipGate` value would silently fall through to "no gate", and the symptom would be a new
 * gate blocking nobody while the server believes it is blocking.
 */
const GATE_PANEL: Record<NonNullable<MembershipGate>, AppGate> = {
	age_required: "age",
	guardian_consent_required: "guardian",
};

export function appGateFor(viewer: Viewer | null): AppGate | null {
	const gate = viewer?.membershipGate ?? null;
	return gate ? GATE_PANEL[gate] : null;
}

/* Failure messages */

/**
 * Error → a sentence a person can read. **Branches on the code only.**
 *
 * The server's `message` is not drawn as is, for the same reason as the other error tables in this
 * app: a caught exception can carry internal details such as the request URL, and what the screen
 * must branch on is the **next step**, not the sentence.
 *
 * **Unknown codes fall back to the generic sentence.** A new failure leaves the screen neither
 * empty nor showing developer text.
 */
const GENERIC = "This can't be done right now. Please try again in a moment.";
const OFFLINE = "Couldn't send the request. Please check your connection.";

const codeOf = (error: unknown): string | null =>
	isRowCatApiError(error) ? error.code : null;

/**
 * Failure of the age declaration.
 *
 * Reasons are not split more finely because this screen has one next step: correct the value and
 * press again.
 */
export function ageDeclarationError(error: unknown): string | null {
	if (!error) return null;
	const code = codeOf(error);
	if (!code) return OFFLINE;
	if (code === "invalid_input" || code === "invalid_request")
		return "Please check your date of birth. A date after today can't be entered.";
	if (code === "login_required")
		return "Your sign-in has expired. Please sign in again.";
	return GENERIC;
}

/**
 * Failure of **creating** a guardian consent request.
 *
 * The point of this table is that `verifierUnavailable` is split out. It means nothing the user
 * does will work right now; saying "try again" would make the child press until it works. Stating
 * that our side is not ready is more honest, and the next step differs.
 */
export function guardianRequestError(error: unknown): string | null {
	if (!error) return null;
	switch (codeOf(error)) {
		case GUARDIAN_ERROR_CODE.verifierUnavailable:
			return "Guardian consent can't be started right now. You'll be able to use it once it's ready.";
		case GUARDIAN_ERROR_CODE.notRequired:
			return "This account doesn't need guardian consent. Please reopen the screen.";
		case "login_required":
			return "Your sign-in has expired. Please sign in again.";
		case null:
			return OFFLINE;
		default:
			return GENERIC;
	}
}
