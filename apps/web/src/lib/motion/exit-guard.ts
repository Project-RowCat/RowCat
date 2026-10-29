import { useIsPresent } from "motion/react";
import type { CSSProperties } from "react";

/**
 * Makes an exiting row unpressable. After a row is removed from product state, it stays on screen
 * while its exit plays. Its links and menus are still real elements, so a just-deleted conversation
 * can be pressed again. Why not set it on the exit target: the value applies when the animation
 * starts, and without frames it never starts. In a hidden tab the row stayed position:absolute with
 * opacity 1 and pointer-events auto, overlapping its siblings until the tab came back. That is when
 * protection matters most, since an exit in a background tab lasts indefinitely. So the guard
 * attaches to React's presence state. useIsPresent() turns false the moment the row leaves product
 * state, which is a render matter and does not depend on frames. It is a hook, so the row must be a
 * component. An m.li expanded inline in a map cannot call a hook, so each list gets its own row
 * component.
 */

/** A module constant, so each render does not create a new style object. */
const EXITING: CSSProperties = { pointerEvents: "none" };

/**
 * Returns the style that blocks presses while exiting, otherwise undefined. Returning undefined is
 * the point: an empty object would always be attached and would silently clash with other code that
 * sets a different value at the same spot.
 */
export function useExitGuard(): CSSProperties | undefined {
	return useIsPresent() ? undefined : EXITING;
}
