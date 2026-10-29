import type { ConnectProviderOutcome } from "./connect-provider.ts";

/**
 * Where a connection failure appears on screen. This is the basis for placing it.
 *
 * connectProvider already distinguishes three kinds: rejected, not_permitted and failed. What was
 * missing was a rule mapping each kind to a place on screen. Without it, the dialog folded all
 * three into one sentence and marked the API key field aria-invalid. A user without a network
 * connection then saw a message other than the provider rejected this key, while the key field was
 * marked invalid, and might discard a valid key.
 *
 * - rejected: a judgment on the value entered. Field scope: aria-invalid and the sentence sit
 *   next to the field.
 * - not_permitted: this account cannot use the feature. Form scope: the field is left alone.
 * - failed: network, limits, provider outage, browser blocking or save failure. Form scope.
 *
 * This is a pure function on purpose. Web tests here do not render React, so a ternary inside the
 * component could only be checked by hand. The symptom of a wrong placement shows up only in
 * assistive technology: the sentence is right while aria-invalid lies.
 *
 * The copy is not here. Which sentence is read comes from connectProvider
 * (credentialFailureMessage). This module decides which place that sentence occupies.
 */

export type ConnectFailureScope = "field" | "form";

/**
 * Maps one failed result to the place where that failure lands. Success (connected) and a collapsed
 * re-run (busy) are not failures, and they never reach this function. Accepting them would add an
 * unanswerable question to the type: where does success land?
 */
export function connectFailureScope(
	status: Exclude<ConnectProviderOutcome["status"], "connected" | "busy">,
): ConnectFailureScope {
	/**
	 * An allow-list, not an exclusion list. If a new failure kind silently fell into the field scope,
	 * that failure would mark the field's value invalid, which is exactly the direction of error this
	 * module exists to prevent. An unknown failure should default to leaving the field alone.
	 */
	return status === "rejected" ? "field" : "form";
}

export interface ConnectFailure {
	scope: ConnectFailureScope;
	message: string;
}

/**
 * The failure that remains after the user edits the API key.
 *
 * A field failure is the provider's judgment of the value that was in the field at that time. Once
 * the value changes, the thing that judgment referred to is gone. Keeping the message and
 * aria-invalid would claim that a value never submitted is invalid. A user who fixed one typo would
 * still see a red field and conclude the whole key is wrong.
 *
 * A form failure is the opposite. A dropped network, a 5xx from the provider, or an account that
 * cannot use personal keys has nothing to do with the characters in the field. Clearing it on one
 * keystroke would remove guidance the user has not read yet. The next submit clears it instead
 * (setFailure(null) in submit).
 *
 * Pure function because the symptom of a mistake here is quiet: a red border that lingers, and for
 * assistive technology a false statement that the input is invalid.
 */
export function failureAfterEdit(
	failure: ConnectFailure | null,
): ConnectFailure | null {
	return failure?.scope === "field" ? null : failure;
}
