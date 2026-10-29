import {
	isThemeColorHex,
	isThemeGradientAngle,
	type ResolvedThemeGradient,
} from "@rowcat/design";

/**
 * - The only place that puts the account background gradient on the document, as one custom
 *   property.
 * - It does not override --background. That is a color token read as a color in several places
 *   (the translucent header surface, the gate overlay, the chat input), and CSS silently ignores an
 *   image string where a color is expected, making those surfaces transparent.
 * - The body rule in packages/ui-web/src/styles/globals.css owns the property (`body {
 *   background-image: var(--account-background-image, none); }`). The gradient is the page floor,
 *   so it is not repeated on bg-background surfaces, where each element would restart it inside its
 *   own box.
 * - background-attachment: fixed keeps the gradient anchored to the viewport. Without it, on
 *   short pages both colors are squeezed into the top few hundred pixels.
 * - Values arrive already validated by @rowcat/design (#rrggbb colors and one integer), but
 *   themeGradientCss checks again because this is the only place the product builds CSS from user
 *   values. If the check fails, nothing is drawn, and staying solid is the safe failure.
 */

/**
 * The 'account-' prefix is the point. This is not a product token but a layer the account put on,
 * so it disappears entirely on logout, account switch, or subscription expiry.
 */
export const ACCOUNT_BACKGROUND_IMAGE_PROPERTY = "--account-background-image";

/**
 * Pins the stops to 0% and 100%. Browsers would use the same positions if they were omitted, but
 * writing them states that the two colors run edge to edge; the string keeps this shape as long as
 * the axis takes only two stops. Returns null when the value falls outside the grammar.
 */
export function themeGradientCss(
	gradient: ResolvedThemeGradient,
): string | null {
	const { from, to, angle } = gradient;
	if (!isThemeColorHex(from) || !isThemeColorHex(to)) return null;
	if (!isThemeGradientAngle(angle)) return null;
	return `linear-gradient(${angle}deg, ${from} 0%, ${to} 100%)`;
}

/**
 * Idempotent: removes the attached gradient, so body's var(…, none) falls back and the background
 * is solid again. Callers need not remember whether a gradient is drawn, which gives the same
 * guarantee as the clearing function in color-overrides.ts.
 */
export function clearAccountBackgroundGradient(root: HTMLElement): void {
	root.style.removeProperty(ACCOUNT_BACKGROUND_IMAGE_PROPERTY);
}

/**
 * Applies the gradient, or removes it when given null. Keeping both paths in one function prevents
 * a caller mistake: an apply-only function would make 'off' a call that does nothing, leaving the
 * previous value in the document until reload, especially on account switch.
 */
export function applyAccountBackgroundGradient(
	root: HTMLElement,
	gradient: ResolvedThemeGradient | null,
): void {
	const css = gradient ? themeGradientCss(gradient) : null;
	if (!css) {
		clearAccountBackgroundGradient(root);
		return;
	}
	root.style.setProperty(ACCOUNT_BACKGROUND_IMAGE_PROPERTY, css);
}
