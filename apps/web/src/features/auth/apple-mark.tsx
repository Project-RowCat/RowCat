/**
 * The Apple brand mark.
 *
 * lucide has no brand icons, so the mark is held here (same reason as `google-mark.tsx`). A generic
 * icon would leave the button's destination only in its text; the logo signals "leaves here for
 * Apple".
 *
 * **The color rule is the opposite of the Google mark's.** That mark hard-codes four brand colors
 * (its identity is the color). The Apple mark is monochrome, and the guideline requires **black or
 * white with enough contrast against the background**. So it uses `currentColor`: black on light
 * themes, white on dark, decided by the theme rather than re-declared here. A hard-coded `#000`
 * would vanish on a dark button in dark theme.
 *
 * It has no size. Buttons resize an svg without a `size-*` class to fit themselves, so setting
 * width or height here would misalign buttons of different sizes.
 */
export function AppleMark() {
	return (
		<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d="M16.365 1.43c0 1.14-.42 2.2-1.13 3.02-.85.99-2.24 1.76-3.4 1.67a3.7 3.7 0 0 1-.03-.42c0-1.1.5-2.26 1.14-2.98.77-.87 2.06-1.53 3.3-1.58l.12.29zM20.9 17.02c-.55 1.27-.82 1.84-1.53 2.97-.99 1.57-2.39 3.53-4.12 3.54-1.54.02-1.93-1-4.02-.99-2.09.01-2.52 1.01-4.06.99-1.73-.01-3.05-1.78-4.04-3.35C.36 15.79-.06 10.6 1.7 8.03c1.25-1.84 3.22-2.91 5.08-2.91 1.89 0 3.08 1.04 4.65 1.04 1.52 0 2.44-1.04 4.63-1.04 1.65 0 3.4.9 4.65 2.45-4.09 2.24-3.43 8.08.19 9.45z" />
		</svg>
	);
}
