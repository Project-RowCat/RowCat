/**
 * The screen owns the value being edited; the record follows. Inputs are controlled components over
 * the SQLite draft record, which autosave updates after the debounce. Reading straight from the
 * record drops typing in between, and the stale snapshot the subscription pushes when a save lands
 * reverts the input. Web hit three symptoms here: the cursor jumps to the end on every save,
 * characters typed meanwhile vanish, and Hangul breaks (a mid-composition value change cuts the
 * composition).
 *
 * So the overlay wins and the record is ignored until the value we sent comes back; then that key
 * leaves the overlay and the record is the reference again, so edits sync brings from another
 * device are accepted.
 *
 * Web hooks each input (`useEditedValue`); here there is one overlay per record, because a native
 * editor stands up ten-plus fields and per-field hooks would catch up at different times, leaving
 * the current value unreadable. The rule is the same.
 *
 * Pure because characters disappear here and this app's tests do not render.
 */

/** Value equality, including arrays (tags). */
function sameValue(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (Array.isArray(a) && Array.isArray(b))
		return a.length === b.length && a.every((item, i) => Object.is(item, b[i]));
	return false;
}

/**
 * Drops only the keys the record has caught up on. Returns the given overlay itself when nothing
 * changes, so callers can skip a render-time `setState` on identity; otherwise this adjustment is
 * itself an infinite render.
 *
 * Keeping keys that have not caught up is the point: autosave can flush an intermediate value
 * (`flush` on backgrounding), so the returning snapshot may not be the last typed value, and
 * accepting it would erase the latest characters while saving nothing (the queue already holds the
 * newest value).
 */
export function reconcileOverlay<T extends object>(
	overlay: Readonly<Partial<T>>,
	record: T,
): Partial<T> {
	let settled = false;
	for (const key of Object.keys(overlay) as (keyof T)[])
		if (sameValue(record[key], overlay[key])) {
			settled = true;
			break;
		}
	if (!settled) return overlay;

	const next: Partial<T> = {};
	for (const key of Object.keys(overlay) as (keyof T)[])
		if (!sameValue(record[key], overlay[key])) next[key] = overlay[key];
	return next;
}

/**
 * The value the screen draws: the overlay over the stored record. Named because callers could
 * easily flip the order, which would overwrite just-typed characters with the stored value.
 */
export const applyOverlay = <T extends object>(
	record: T,
	overlay: Readonly<Partial<T>>,
): T => ({ ...record, ...overlay });
