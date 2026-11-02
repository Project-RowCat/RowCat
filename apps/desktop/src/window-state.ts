/**
 * Where each window was when it last closed, so it opens there again.
 *
 * **A stored position is a claim about a screen that may be gone.** A laptop that was on an external
 * monitor yesterday opens without it today, and a window restored to coordinates nothing displays is a
 * window the person cannot find — the app looks like it did not start. So a stored rectangle is kept
 * only while enough of it lands on a display that exists now (`restoreBounds`), and otherwise the OS
 * places the window.
 *
 * The record is a device's taste: it lives in the app's own folder beside the logs, not in the
 * deployment's data folder and not in any account.
 */

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface SavedWindow {
	bounds: Rect;
	maximized: boolean;
}

/** How much of a restored window must be on some display, per axis, for it to be findable. */
const MIN_VISIBLE = 120;

export function restoreBounds(
	saved: unknown,
	workAreas: Rect[],
	minimum: { width: number; height: number },
): SavedWindow | null {
	if (!isSavedWindow(saved)) return null;
	const { bounds } = saved;
	if (bounds.width < minimum.width || bounds.height < minimum.height)
		return null;
	const visible = workAreas.some(
		(area) =>
			overlap(bounds.x, bounds.width, area.x, area.width) >= MIN_VISIBLE &&
			overlap(bounds.y, bounds.height, area.y, area.height) >= MIN_VISIBLE,
	);
	return visible ? saved : null;
}

function overlap(a: number, aSize: number, b: number, bSize: number): number {
	return Math.min(a + aSize, b + bSize) - Math.max(a, b);
}

function isSavedWindow(value: unknown): value is SavedWindow {
	if (typeof value !== "object" || value === null) return false;
	const { bounds, maximized } = value as Partial<SavedWindow>;
	return (
		typeof maximized === "boolean" &&
		typeof bounds === "object" &&
		bounds !== null &&
		[bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
	);
}
