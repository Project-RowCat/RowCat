/**
 * Which container holds message edit, decided by device geometry alone.
 *
 * This is the one short form in the slice whose content height is unpredictable: it has a
 * multi-line input (min 120pt, larger with big text), an optional warning, an optional error, fixed
 * buttons and title, and a keyboard that is always up (the field autofocuses). On large screens
 * that fits a centered box. On short ones the height left above the keyboard roughly equals the
 * form, so the box nearly fills the screen, which is a screen rather than a dialog (`Dialog`'s own
 * rule says a `compact` that nearly fills the screen is wrong).
 *
 * It does not fall to a sheet: that was the old answer and made every form here a bottom panel. A
 * short screen needs a bigger form surface, not a rising gesture.
 *
 * It does not key on keyboard state: swapping containers while typing redraws everything and jumps
 * the caret, scroll position and accessibility focus. Device height is stable until rotation.
 */

/**
 * Below this a centered box nearly fills the screen. On iPhone SE (667pt) the soft keyboard takes
 * about 291pt, leaving roughly 340pt after safe areas, close to the form's minimum (title 44 +
 * input 120 + warning 40 + buttons 44 + padding 48). iPhone 13/15 (844/852pt) and most Android
 * devices are well above. 700 is a device classification, not a spacing value.
 */
export const COMPACT_EDITOR_MIN_WINDOW_HEIGHT = 700;

export type MessageEditPresentation = "dialog" | "full";

export function messageEditPresentation(
	windowHeight: number,
): MessageEditPresentation {
	// Odd values (0, negative, NaN, which do occur on first render and in test harnesses) go to the
	// wide side: that mistake makes the form larger than needed, the opposite clips text.
	if (!Number.isFinite(windowHeight) || windowHeight <= 0) return "full";
	return windowHeight >= COMPACT_EDITOR_MIN_WINDOW_HEIGHT ? "dialog" : "full";
}
