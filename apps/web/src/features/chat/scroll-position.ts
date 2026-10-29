/**
 * The distance from the bottom, as a single-purpose unit. Extracted because the same subtraction is
 * needed in four places: scroll events, a new message being saved, a response growing, and pressing
 * `Jump to latest`. If each place computed it, one missing clientHeight would give a wrong button on that
 * path only, invisible until reproduced.
 *
 * The two thresholds stay separate on purpose. One answers 'may we follow new content?'; the other
 * answers 'is the jump button worth showing?'. The second must be more generous: a button
 * flickering while still on screen is more distracting than the button being absent. The band
 * between (80-320px) is a normal zone where neither applies.
 *
 * Reading the DOM and judging are separate functions on purpose. The judgment works on numbers
 * alone and can be checked without layout, which is where mistakes are likely.
 */

/**
 * The distance within which the user counts as looking at the bottom. Exactly 0 makes the judgment
 * flip during inertial scrolling.
 */
export const BOTTOM_THRESHOLD_PX = 80;

/**
 * The distance at which the jump-to-latest button appears. More generous than the bottom threshold,
 * as explained above.
 */
export const JUMP_THRESHOLD_PX = 320;

/**
 * The pixels left to the bottom now. Measured from the far end rather than scrollTop from the top:
 * the list grows both up and down, and the bottom is the one reference whose meaning does not
 * change as it grows.
 */
export function getDistanceFromBottom(viewport: HTMLElement): number {
	return viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
}

export function isAtBottom(distance: number): boolean {
	return distance <= BOTTOM_THRESHOLD_PX;
}

export function shouldShowJump(distance: number): boolean {
	return distance > JUMP_THRESHOLD_PX;
}
