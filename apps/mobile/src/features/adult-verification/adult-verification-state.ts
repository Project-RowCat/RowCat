import type { AdultVisibilityState } from "@rowcat/domain";
import type { AdultVerificationFailure } from "./adult-verification-error.ts";
import type { NativeVerificationPlan } from "./adult-verification-handoff.ts";

/**
 * Screen state for adult verification: pure types and one decision. Same axis as the web's
 * `features/account/adult-verification-state.ts`.
 *
 * Four things must be told apart (what to offer, which phase, what failed, what is pressable), so
 * conditions are not scattered through JSX where two do-nothing states fold into one branch.
 *
 * Eligibility itself is not decided here: the server decides `verified`/`adult` and they arrive on
 * the viewer. Reassembling it would briefly show an account as open before the server opened it.
 */

/**
 * What to offer this person.
 *
 * ```text
 * none      nothing — a child, or eligible with a check under a year old
 * verify    never verified
 * reverify  verified, but was under 19 at the time
 * renew     eligible, but the last check is over a year old
 * ```
 *
 * `renew` and `reverify` are opposite people: the first is an adult with a clear task, the second
 * has nothing to do but wait.
 *
 * Always `none` for a child: `adultVisibilityState` judges children first and this inherits that
 * order. Telling an under-14 to verify would be false, and the server gates the same
 * (`requireNonChild`). Having a native SDK does not change this: being able to open the window and
 * the account having this procedure are different questions.
 */
export type AdultVerificationOffer = "none" | "verify" | "reverify" | "renew";

export function adultVerificationOffer(
	state: AdultVisibilityState,
): AdultVerificationOffer {
	if (state.kind === "unverified") return "verify";
	if (state.kind === "minor") return "reverify";
	/** The server counted the year (`Viewer.adultRecheckRequired`); the device clock is not read. */
	if (state.kind === "eligible" && state.recheckRequired) return "renew";
	return "none";
}

/**
 * The procedure's phase. Not folded into booleans because each phase differs in what the user sees
 * and can press.
 *
 * ```text
 * idle              nothing running; a past failure may remain
 * beginning         the RowCat server is creating the attempt
 * provider          the authority's window is up; our screen does nothing meanwhile
 * completing        the authority is done and the server is re-asking
 * completion_failed verification finished but could not be reflected — do not reopen the authority
 * ```
 *
 * Cancel and authority failure are not separate phases: the user can do the same as in `idle`
 * (start over) and they differ only in whether `failure` has a sentence. `completion_failed` has a
 * different action, so it keeps its own phase.
 */
export type AdultVerificationPhase =
	/**
	 * Nothing running; a past failure or a just-reflected result may remain.
	 *
	 * `settled` exists because verification can finish with the screen unchanged (an account
	 * re-verified as under 19), which the user would read as a press that did nothing. It is a line
	 * left in place, not a success toast, and the next start clears it.
	 */
	| { kind: "idle"; failure: AdultVerificationFailure | null; settled: boolean }
	| { kind: "beginning" }
	| { kind: "provider"; plan: NativeVerificationPlan }
	| { kind: "completing" }
	| { kind: "completion_failed"; failure: AdultVerificationFailure };

export const ADULT_VERIFICATION_IDLE: AdultVerificationPhase = {
	kind: "idle",
	failure: null,
	settled: false,
};

/** Right after the server settled the result. */
export const ADULT_VERIFICATION_SETTLED: AdultVerificationPhase = {
	kind: "idle",
	failure: null,
	settled: true,
};

/** `completion_failed` is not locked: there is something to press in that phase. */
export const adultVerificationBusy = (phase: AdultVerificationPhase): boolean =>
	phase.kind === "beginning" ||
	phase.kind === "provider" ||
	phase.kind === "completing";

export const adultVerificationSurface = (
	phase: AdultVerificationPhase,
): NativeVerificationPlan | null =>
	phase.kind === "provider" ? phase.plan : null;
