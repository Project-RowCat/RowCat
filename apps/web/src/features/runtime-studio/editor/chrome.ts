import {
	RUNTIME_CHROME_DARK,
	RUNTIME_CHROME_LIGHT,
	type RuntimeEditorChrome,
} from "./monaco-theme.ts";

/**
 * Reads the editor surface (background and foreground) from the colors actually on screen. Syntax
 * colors do not come from here.
 *
 * Why read at all: some deployments let the account theme cover the background (four presets plus a
 * subscriber's arbitrary color). A frozen background value would show a different color in the
 * middle of the screen for those accounts, and it would not reproduce on our machines, which use
 * the default theme.
 *
 * Why convert to hex: Monaco's theme does not accept `var(--background)`. This app's tokens are
 * `oklch()`, and computed values stay `oklch()` (CSS Color 4 rule). Bundling a converter is not the
 * answer, because `@rowcat/design`'s converter is generation-time code and its header says not to
 * use it at runtime.
 *
 * So the browser does the conversion: a canvas `fillStyle` normalizes any CSS color syntax to
 * `#rrggbb`. If it cannot parse a value, the assignment is silently ignored, so a marker placed
 * beforehand makes that failure visible as a value (no exception).
 *
 * Failure falls back to defaults rather than blocking the editor. Without a canvas (tests, old
 * browsers), the default surface of the appearance is used. A slightly off surface and an editor
 * that will not open have very different weights.
 */

const SOURCES: Record<keyof RuntimeEditorChrome, string> = {
	background: "--card",
	foreground: "--foreground",
	surface: "--muted",
	border: "--border",
	selection: "--accent",
	cursor: "--primary",
	muted: "--muted-foreground",
};

let probe: CanvasRenderingContext2D | null | undefined;

/** Reuses one canvas context; there is no reason to create a canvas per color. */
function context(): CanvasRenderingContext2D | null {
	if (probe !== undefined) return probe;
	try {
		probe = document.createElement("canvas").getContext("2d");
	} catch {
		probe = null;
	}
	return probe;
}

/**
 * Converts one CSS color string to `#rrggbb`, or returns `null` if unknown. The marker (`#ff00ff`)
 * is set first because the browser's rejection is silent: an unknown syntax leaves the previous
 * value in place.
 */
export function cssColorToHex(value: string): string | null {
	const trimmed = value.trim();
	if (!trimmed) return null;
	if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toLowerCase();

	const ctx = context();
	if (!ctx) return null;
	const sentinel = "#ff00ff";
	ctx.fillStyle = sentinel;
	ctx.fillStyle = trimmed;
	const resolved =
		typeof ctx.fillStyle === "string" ? ctx.fillStyle.toLowerCase() : "";
	if (!/^#[0-9a-f]{6}$/.test(resolved)) return null;
	/**
	 * The input may itself be the marker color. If the result equals the marker, the check is repeated
	 * with a second marker to tell a real match from a rejected value.
	 */
	if (resolved === sentinel) {
		ctx.fillStyle = "#00ff00";
		ctx.fillStyle = trimmed;
		return typeof ctx.fillStyle === "string" &&
			ctx.fillStyle.toLowerCase() === sentinel
			? sentinel
			: null;
	}
	return resolved;
}

/**
 * Reads the surface from the theme this element inherits. Taking the element as an argument is the
 * point: the account theme lands on the root today, but if a section ever gets its own palette, the
 * editor must follow the colors of the place where it sits.
 */
export function readRuntimeEditorChrome(
	element: Element | null,
	dark: boolean,
): RuntimeEditorChrome {
	const base = dark ? RUNTIME_CHROME_DARK : RUNTIME_CHROME_LIGHT;
	if (!element || typeof getComputedStyle !== "function") return base;

	const style = getComputedStyle(element);
	const resolved: Partial<RuntimeEditorChrome> = {};
	for (const [slot, token] of Object.entries(SOURCES)) {
		const hex = cssColorToHex(style.getPropertyValue(token));
		if (hex) resolved[slot as keyof RuntimeEditorChrome] = hex;
	}
	return { ...base, ...resolved };
}
