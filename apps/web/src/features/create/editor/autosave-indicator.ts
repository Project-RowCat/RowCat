import { translator } from "#/lib/i18n/current.ts";
import type { AutosaveSnapshot, AutosaveStatus } from "./use-autosave.ts";

/**
 * Pure decision for the save indicator: what it draws, what it announces, and what it offers. It
 * lives outside the component because this repo's web tests do not render React, so the
 * accessibility contract has to be checkable as values.
 *
 * Only failure breaks the silence. idle, pending, saving and saved stay quiet because they pass
 * several times per second while typing; error is announced. The wrapper is deliberately not a live
 * region, since a role="status" container would read every transition and drown out the error. That
 * is why only the failure text carries its own role="alert".
 *
 * The retry condition uses the same inputs as shouldBlockLeave but answers a different question:
 * whether there is something to retry now, not whether leaving is safe. Defining one in terms of
 * the other would hide the retry button whenever the leave policy changes.
 */

const autosaveLabel = (key: AutosaveStatus): string =>
	translator("create")(`autosave.${key}`);

export interface AutosaveIndicatorView {
	/** The visible text. Assistive technology reads this same sentence; there is no hidden copy. */
	label: string;
	/** Whether the text is rendered as role="alert". True only for failures. */
	announce: boolean;
	retryable: boolean;
}

export function autosaveIndicatorView(
	snapshot: AutosaveSnapshot,
): AutosaveIndicatorView {
	const failed = snapshot.status === "error";
	return {
		label: autosaveLabel(snapshot.status),
		announce: failed,
		/**
		 * There is nothing to retry when no changes are pending. Offering the button based on the label
		 * alone would create a button that does nothing when pressed, indistinguishable from a broken
		 * one.
		 */
		retryable: failed && snapshot.pending,
	};
}
