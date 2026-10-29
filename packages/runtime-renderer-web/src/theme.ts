/**
 * The renderer's own trusted default style. It is not creator CSS.
 * - Shadow DOM: RowCat's global CSS (Tailwind preflight, account themes, component classes) would
 *   otherwise restyle runtime primitives. That would look correct only in the studio and draw
 *   differently in a playback shell. The shadow root keeps only inheritable :host properties (font,
 *   color) and a few variables inside.
 * - This is not isolation. It limits style, not code. Creator JavaScript runs in QuickJS/WASM and
 *   never reaches this document.
 * - --rowcat-runtime-* variables are host configuration that creator code cannot read or set.
 *   They are named apart from @rowcat/ui-web tokens, since this package must not depend on the
 *   app's design system.
 * - Focus outlines are not removed globally. :focus-visible draws them, because a runtime
 *   unusable without a mouse is not a runtime.
 */

export const WEB_RUNTIME_THEME_VARIABLES = [
	"--rowcat-runtime-bg",
	"--rowcat-runtime-fg",
	"--rowcat-runtime-primary",
	"--rowcat-runtime-primary-fg",
	"--rowcat-runtime-secondary",
	"--rowcat-runtime-secondary-fg",
	"--rowcat-runtime-border",
	"--rowcat-runtime-muted",
	"--rowcat-runtime-font",
] as const;

export type WebRuntimeThemeVariable =
	(typeof WEB_RUNTIME_THEME_VARIABLES)[number];

/**
 * Default sheet inside the shadow root. Each primitive kind has one class (rc-<kind>), and creator
 * styles are applied inline on top of it (styles.ts). Box primitives all use display: flex with
 * flex-direction: column, to match the default of RN's View. Both renderers must read grow, justify
 * and align with the same meaning inside the same parent.
 */
export const WEB_RUNTIME_BASE_CSS = `
:host { display: block; height: 100%; min-height: 0; }
.rc-root {
	position: relative;
	box-sizing: border-box;
	width: 100%;
	height: 100%;
	min-height: 0;
	overflow: hidden;
	display: flex;
	flex-direction: column;
	color: var(--rowcat-runtime-fg, #1c1c1c);
	background: var(--rowcat-runtime-bg, #ffffff);
	font: 14px/1.5 var(--rowcat-runtime-font, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif);
}
.rc-root *, .rc-root *::before, .rc-root *::after { box-sizing: border-box; }
.rc-screen {
	flex: 1 1 auto;
	width: 100%;
	height: 100%;
	min-height: 0;
	overflow: hidden;
	display: flex;
	flex-direction: column;
}
.rc-view, .rc-stack { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.rc-row { display: flex; flex-direction: row; min-width: 0; min-height: 0; }
/*
 * Children of a vertically stacked box **do not shrink.**
 *
 * CSS's default \`flex-shrink\` is 1 and Yoga's (native) is 0. Leaving that difference makes the same
 * story stand differently in the two renderers, and the web side is simply wrong: inside an ancestor with a
 * fixed height, longer content **squashes** the children. Then a \`ScrollView\`'s content doesn't scroll
 * (the content is squeezed to fit the box, so \`scrollHeight\` doesn't grow) and text overflows the squeezed
 * box onto the next card. It appears the moment one screen grows past the viewport, so short examples
 * never show it (it surfaced only after actually pressing through the flagship).
 *
 * Horizontally placed boxes are the opposite. Text inside a \`Row\` must be able to shrink to wrap; otherwise
 * one long sentence is cut off past the row. So this rule **looks at the parent's main axis**
 * to decide, because the axis \`flex-shrink\` measures is the parent's main axis.
 *
 * Children of horizontal scrolling take the first rule as is (shrinking would leave nothing to scroll). Images,
 * progress bars and **buttons** don't shrink even inside rows: they size themselves, and native
 * needs the same exception so both renderers give the same answer for the same set.
 *
 * ⚠️ Buttons joined that list late, and in the meantime it was really broken. A \`<Button>Send</Button>\`
 * next to an input with \`grow: 1\` was squeezed narrower than its label, and \`.rc-text\`'s
 * \`overflow-wrap: anywhere\` split that label **per character** into two lines (with a Korean
 * label, one syllable per line; it surfaced by actually opening Messenger in the starter template lab). Creators have no way
 * around it, which is this exception's basis: \`ButtonProps\` has no \`style\`, so there is nowhere to
 * write \`shrink: 0\` (so this is the renderer's defect, not the template's).
 *
 * \`.rc-pressable\` is **left out on purpose.** It takes \`style\`, so creators can decide for themselves,
 * and as a container holding arbitrary content it can't be said to "size itself" either.
 */
.rc-root > *, .rc-screen > *, .rc-view > *, .rc-stack > *, .rc-scroll > * { flex-shrink: 0; }
.rc-row > * { flex-shrink: 1; }
.rc-row > .rc-image, .rc-row > .rc-progress, .rc-row > .rc-button { flex-shrink: 0; }
.rc-scroll {
	display: flex;
	flex-direction: column;
	min-width: 0;
	min-height: 0;
	overflow-x: hidden;
	overflow-y: auto;
}
.rc-scroll[data-rc-horizontal="true"] {
	flex-direction: row;
	overflow-x: auto;
	overflow-y: hidden;
}
.rc-text { display: block; min-width: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.rc-image { display: block; max-width: 100%; }
.rc-image[data-rc-missing] {
	min-width: 2rem;
	min-height: 2rem;
	background: var(--rowcat-runtime-muted, #e6e6e6);
	color: var(--rowcat-runtime-fg, #1c1c1c);
}
.rc-button {
	appearance: none;
	-webkit-appearance: none;
	font: inherit;
	line-height: 1.25;
	cursor: pointer;
	display: inline-flex;
	align-items: center;
	justify-content: center;
	gap: 0.5em;
	padding: 0.5em 1em;
	border-radius: 0.5em;
	border: 1px solid var(--rowcat-runtime-border, #c9c9c9);
	background: var(--rowcat-runtime-secondary, #f0f0f0);
	color: var(--rowcat-runtime-secondary-fg, #1c1c1c);
}
.rc-button[data-rc-tone="primary"] {
	border-color: transparent;
	background: var(--rowcat-runtime-primary, #2f5bff);
	color: var(--rowcat-runtime-primary-fg, #ffffff);
}
.rc-button[data-rc-tone="ghost"] {
	border-color: transparent;
	background: transparent;
	color: inherit;
}
.rc-pressable {
	appearance: none;
	-webkit-appearance: none;
	border: 0;
	background: transparent;
	font: inherit;
	color: inherit;
	padding: 0;
	margin: 0;
	text-align: inherit;
	cursor: pointer;
	display: flex;
	flex-direction: column;
	min-width: 0;
	min-height: 0;
}
.rc-button:disabled, .rc-pressable:disabled { cursor: not-allowed; opacity: 0.5; }
.rc-button:focus-visible, .rc-pressable:focus-visible {
	outline: 2px solid var(--rowcat-runtime-primary, #2f5bff);
	outline-offset: 2px;
}
.rc-progress { display: block; width: 100%; accent-color: var(--rowcat-runtime-primary, #2f5bff); }
.rc-text-input, .rc-text-area {
	appearance: none;
	-webkit-appearance: none;
	font: inherit;
	color: inherit;
	min-width: 0;
	width: 100%;
	padding: 0.5em 0.75em;
	border-radius: 0.5em;
	border: 1px solid var(--rowcat-runtime-border, #c9c9c9);
	background: var(--rowcat-runtime-bg, #ffffff);
}
.rc-text-area { display: block; min-height: 4.5em; resize: vertical; }

/* Sound is not drawn: even an <audio> without controls takes up space in some browsers. */
.rc-audio { display: none; }
.rc-text-input:disabled, .rc-text-area:disabled { cursor: not-allowed; opacity: 0.5; }
.rc-text-input:focus-visible, .rc-text-area:focus-visible {
	outline: 2px solid var(--rowcat-runtime-primary, #2f5bff);
	outline-offset: 1px;
}
`;
