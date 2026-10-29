import { useSyncExternalStore } from "react";
import { prefersSoftKeyboardComposer } from "./submit.ts";

/**
 * Answers whether the composer uses the soft keyboard, based on this browser's input capabilities.
 *
 * The decision lives in the pure predicate `prefersSoftKeyboardComposer`. This file only subscribes
 * to the two facts that predicate receives, so it has no `&&` or `||`. An inline rule could then
 * only be checked by hand, since the web tests here do not render React.
 *
 * It uses `useSyncExternalStore` because the value cannot be known on the server. The server
 * snapshot is `false`, the safe direction: if Enter is judged to send before hydration, the handler
 * is not attached yet, and the real value is drawn once it is. Starting from `true` would turn a
 * desktop user's first Enter into a silent line break.
 *
 * The value rarely changes (only when a mouse is plugged in or removed), so the subscription costs
 * almost nothing. Its value is that such a change is reflected: a value read once and frozen would
 * leave a tablet user with a keyboard attached unable to send with Enter until reload.
 */

const COARSE_POINTER = "(pointer: coarse)";
const HOVER_CAPABLE = "(hover: hover)";

/** The server has no input devices. `false` is the safe value (see above). */
const serverSnapshot = () => false;

function subscribe(onChange: () => void): () => void {
	if (typeof window === "undefined" || !window.matchMedia) return () => {};
	const lists = [
		window.matchMedia(COARSE_POINTER),
		window.matchMedia(HOVER_CAPABLE),
	];
	for (const list of lists) list.addEventListener("change", onChange);
	return () => {
		for (const list of lists) list.removeEventListener("change", onChange);
	};
}

/**
 * The snapshot is a single boolean.
 *
 * Returning the two media query results as an object would produce a new reference on every render,
 * and `useSyncExternalStore` would loop forever. Finishing the decision here answers that
 * constraint, and the rule itself still lives in one pure function.
 */
function getSnapshot(): boolean {
	if (typeof window === "undefined" || !window.matchMedia) return false;
	return prefersSoftKeyboardComposer({
		coarsePointer: window.matchMedia(COARSE_POINTER).matches,
		hoverCapable: window.matchMedia(HOVER_CAPABLE).matches,
	});
}

export function useSoftKeyboardComposer(): boolean {
	return useSyncExternalStore(subscribe, getSnapshot, serverSnapshot);
}
