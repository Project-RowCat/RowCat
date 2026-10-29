import { useState } from "react";

/**
 * The screen owns the value being edited; the record follows behind.
 *
 * The input is a controlled component driven by the IndexedDB draft record, which autosave
 * (use-draft-autosave.ts) updates 500ms later. Reading the value straight from the record breaks
 * three things while the user types:
 * - The caret jumps to the end on every save, because React rewrites the controlled value.
 * - Characters typed during the delay vanish, since liveQuery pushes back the saved snapshot.
 * - Korean input breaks: a value change during composition (compositionstart to compositionend)
 *   cancels the composition, and the jamo pressed at that moment are lost.
 *
 * So the local value wins, and the record is ignored until it returns the value that was sent (the
 * record has caught up). After that the record is authoritative again, so edits from other tabs and
 * later syncs reach the screen. Leaving the input uncontrolled would miss those changes, which is
 * why this reconciliation is needed.
 *
 * The rule is a pure function so it can be tested without rendering, since this repo's web tests
 * are pure logic tests (apps/web/vitest.config.ts).
 */

export interface EditedValue<T> {
	value: T;
	/**
	 * The value that was sent out but has not come back from the record yet. null means the screen and
	 * the record match.
	 *
	 * This tracks whether the record has caught up, not whether a save is running. Autosave can send
	 * intermediate values (such as the flush on collapse), so the snapshot that returns may not be the
	 * last typed value; the screen still wins in that case.
	 */
	pending: T | null;
}

/**
 * The next state when a new record value arrives.
 *
 * If nothing changes, the received state object is returned unchanged, so the caller can skip
 * setState during render by checking identity only.
 */
export function reconcileEditedValue<T>(
	state: EditedValue<T>,
	record: T,
	isEqual: (a: T, b: T) => boolean = Object.is,
): EditedValue<T> {
	if (state.pending !== null) {
		// The value we sent has come back. This round is over, and the record is listened to again.
		if (isEqual(record, state.pending))
			return { value: state.value, pending: null };
		/**
		 * Not caught up yet. Accepting the record here would erase the character just typed each time a
		 * queued save arrives. The queue already holds the latest value, so reverting the screen to an
		 * old value gains nothing and only loses input.
		 */
		return state;
	}
	if (isEqual(record, state.value)) return state;
	// A value we did not produce, written by another tab or by sync. That side is the authority, so
	// take it.
	return { value: record, pending: null };
}

export function startEditingValue<T>(next: T): EditedValue<T> {
	return { value: next, pending: next };
}

/**
 * Attaches the rule above to a single input.
 *
 * `commit` runs on every keystroke; debouncing belongs to autosave. Deferring here would switch the
 * `Waiting to save` indicator on later than the real edit, and the flush on collapse would miss characters
 * typed inside that window.
 */
export function useEditedValue<T>(
	record: T,
	commit: (next: T) => void,
	isEqual: (a: T, b: T) => boolean = Object.is,
): [T, (next: T) => void] {
	const [state, setState] = useState<EditedValue<T>>(() => ({
		value: record,
		pending: null,
	}));

	// Adjusting state during render is React's documented pattern for syncing state to new props.
	// Doing it in an effect would lag one frame.
	const next = reconcileEditedValue(state, record, isEqual);
	if (next !== state) setState(next);

	return [
		next.value,
		(value: T) => {
			setState(startEditingValue(value));
			commit(value);
		},
	];
}
