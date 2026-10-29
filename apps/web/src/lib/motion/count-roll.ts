import {
	COUNT_ROLL_SHIFT,
	type CountRollCadence,
	type CountRollCell,
	type CountRollDirection,
	countRollCells,
	countRollDirection,
	countRollHasTime,
} from "@rowcat/design";
import type { Transition } from "motion/react";
import {
	continuousEnterTransition,
	continuousExitTransition,
	enterTransition,
	exitTransition,
} from "./transitions.ts";

/**
 * Rhythm for one number that changes in place. It is the same kind of file as list-motion.ts and
 * feedback.ts, and the axis is what moves. Those two are items that enter and leave (presence).
 * This number has been on screen all along, so the feedback is direct, not presence. It is the same
 * as the heart pulse, and one user action (favoriting) drives both.
 * - Judged by position, not by reason: a number of the same meaning that stays mounted and
 *   changes value rolls, whether it came from a user action, a per-second timer, or a background
 *   refresh. Cadence is the only split.
 * - A first mount is not a change: the content arrived, and rolling would imply a previous value
 *   that never existed.
 * - Counts from the right. Counting from the left would move every cell when the digit count
 *   changes (9 to 10), rolling a number that did not change.
 * - Intermediate values are never generated. Cells know only the previous and current glyph, so 8
 *   to 3 cannot pass through 9, 0, 1, 2. Accessible text is always the real number.
 */

/**
 * Position judgment, direction, cadence, and distance live in @rowcat/design, because web and
 * native must pass the same rules through the same functions. What remains here only maps that
 * judgment into Motion's shape and re-exports it, so this file's public shape is unchanged. These
 * are the rules copies diverge on: the right-to-left identity, the direction when the digit count
 * changes, and the last signal of the cap notation (99+). All three can be wrong and still compile
 * with silent symptoms.
 */
export {
	COUNT_ROLL_SHIFT,
	type CountRollCadence,
	type CountRollCell,
	countRollCells,
	type CountRollDirection,
	countRollDirection,
	countRollHasTime,
};

/**
 * Rhythm per cadence. Easing is shared across cadences; only the durations differ (see
 * transitions.ts).
 */
const CADENCE_TRANSITION: Record<
	CountRollCadence,
	{ in: Transition; out: Transition }
> = {
	default: { in: enterTransition, out: exitTransition },
	continuous: { in: continuousEnterTransition, out: continuousExitTransition },
};

/**
 * The incoming glyph. initial is set only on changed cells, so unchanged cells do not remount at
 * all. This is the same place where the list's rowEnter leaves the first render to presence; here
 * the judgment is 'changed'. That is why nothing rolls on server render or right after mount.
 * Cadence is required with no default. A default would let a new consumer skip the question, and a
 * per-second number rolling at default weight is the quietest way this transition breaks.
 */
export function countRollIn(
	direction: CountRollDirection,
	cadence: CountRollCadence,
) {
	const shift = COUNT_ROLL_SHIFT[cadence];
	return {
		initial: { y: `${direction * shift}%`, opacity: 0 },
		animate: { y: "0%", opacity: 1 },
		transition: CADENCE_TRANSITION[cadence].in satisfies Transition,
	} as const;
}

/**
 * The outgoing glyph is faster than the incoming one and moves the opposite way. Both use the same
 * cell at the same time (one is out of flow), so if their directions differed they would pass
 * through each other. Flowing the same way reads as one glyph giving its place to the next.
 */
export function countRollOut(
	direction: CountRollDirection,
	cadence: CountRollCadence,
) {
	const shift = COUNT_ROLL_SHIFT[cadence];
	return {
		initial: { y: "0%", opacity: 1 },
		animate: { y: `${-direction * shift}%`, opacity: 0 },
		transition: CADENCE_TRANSITION[cadence].out satisfies Transition,
	} as const;
}
