/**
 * Where a dialog stands. This is geometry only, not a container.
 * - Web dialogs dock to the bottom on narrow screens and float centered above sm. Native always
 *   drew them centered, so the same settings screen looked like two products.
 * - Not solved with a sheet: a sheet is defined by whether rising from the bottom adds value to
 *   the interaction, and conversation settings do not meet that (see sheet.tsx).
 * - Only coordinates change. role, aria-modal, Android back, screen-reader escape and focus
 *   ownership do not.
 * - A pure module, because a rule inside a component cannot be checked without rendering and
 *   wrong results are silent. color-scheme.ts was split out for the same reason.
 */

/**
 * The three values:
 * - center: a centered box with bounded width and height; the screen behind shows on all sides.
 * - bottom: a full-width panel docked to the bottom, with only the top corners rounded.
 * - adaptive: device geometry decides. Hand-held screens get bottom, tablets get center. The
 *   default is center, not adaptive. Switching everything to adaptive would move currently centered
 *   windows without a call-site decision. Which windows dock is a product choice, and opting in
 *   keeps it visible where it is made.
 */
export type DialogPlacement = "center" | "bottom" | "adaptive";

/**
 * The width at which adaptive switches to center.
 * - Matches the web sm breakpoint (640px) as a product decision, not as the same pixel value.
 * - Below it is all one-hand use (the largest phone is 430pt); above it is tablets (the smallest
 *   iPad in portrait is 744pt).
 * - The gap is wide, so the boundary can move either way without a real device landing on the
 *   wrong side. Not split by Platform.OS: the question is how much width is usable, which separates
 *   tablets within iOS too.
 */
export const DIALOG_ADAPTIVE_CENTER_MIN_WIDTH = 640;

/**
 * The actual placement on this device. An unknown width (0, negative or NaN) folds to the hand-held
 * side. A tablet sheet that is a bit too wide is a mild error; a 320pt device with the box covering
 * the whole screen is a severe one.
 */
export function resolveDialogPlacement(
	placement: DialogPlacement,
	width: number,
): "center" | "bottom" {
	if (placement !== "adaptive") return placement;
	return width >= DIALOG_ADAPTIVE_CENTER_MIN_WIDTH ? "center" : "bottom";
}
