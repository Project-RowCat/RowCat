/**
 * Pure rule that compares one changing number digit by digit. It is a decision, not a value or a
 * render. It imports nothing from Motion, Reanimated or React.
 *
 * - Digits are compared from the right, so a cell's identity stays stable when the digit count
 *   changes.
 * - Direction and the capped-notation marker (99+) are part of the rule. Copies would drift
 *   silently.
 * - Lives here rather than in a separate motion package because it shares COUNT_ROLL_SHIFT and
 *   CountRollCadence with motion.ts.
 * - Intermediate digits are never invented. A cell knows only the previous and current glyph, so
 *   the visible text is always the current number, even mid-animation.
 */

import {
	type CountRollCadence,
	motionContinuousDurationMs,
	motionDurationMs,
} from "./motion.ts";

/** One digit cell. Drawn left to right, but its identity is its distance from the right. */
export type CountRollCell = {
	/**
	 * Position counted from the right, with the ones digit as '0'. Used as the list key. An array
	 * index would shift every cell's identity on 99 → 100, so unchanged digits would roll.
	 */
	key: string;
	character: string;
	/**
	 * The glyph that occupied this cell before. Empty string when the cell did not exist, so there is
	 * no outgoing glyph.
	 */
	previous: string;
	/**
	 * Whether the cell should roll. Right after mount no cell is true, since the previous value equals
	 * the current one.
	 */
	changed: boolean;
};

/**
 * Aligns the two notations on the right and compares them digit by digit.
 *
 * The cell count equals the length of the next value. A leading digit that disappears (the 1 in 100
 * → 99) has no cell. Keeping it would either clip digits in a shrinking box or leave a stale digit
 * standing for one extra beat.
 */
export function countRollCells(
	previous: string,
	next: string,
): CountRollCell[] {
	const cells: CountRollCell[] = [];
	for (let index = 0; index < next.length; index += 1) {
		const offset = next.length - 1 - index;
		const character = next[index] ?? "";
		const before = previous[previous.length - 1 - offset] ?? "";
		cells.push({
			key: String(offset),
			character,
			previous: before,
			changed: before !== character,
		});
	}
	return cells;
}

/** Roll direction. An increase rolls up from below and a decrease rolls down from above. */
export type CountRollDirection = 1 | -1;

/**
 * Keeps only the digits of a notation, stripping separators, spaces and unit characters.
 *
 * Direction is decided from notations, so a raw string comparison would be wrong. In 999 → 1,000
 * the comma takes a slot and the length check disagrees with the digit count.
 */
const digitsOf = (text: string): string => text.replace(/\D+/g, "");

/** Strips leading zeros (007 becomes 7). Keeps a single 0 when nothing else remains. */
const significant = (digits: string): string => digits.replace(/^0+(?=\d)/, "");

/**
 * A trailing + in a capped notation (such as 99+) is the last signal, used only when the digit
 * strings are equal. The + means 'more than this' and is part of the value, not a unit. Digit-only
 * extraction drops it, so 99+ → 99 (a decrease below the cap) read as 'same number' and rolled up
 * by default. The failure is silent.
 */
const cappedNotation = /\+\s*$/;

/**
 * Direction is decided by the whole number, not per digit. Comparing digit by digit would make 199
 * → 200 roll the ones digit down while the number went up.
 *
 * Takes notations, not numbers, because each consumer has its own formatter. Different digit
 * counts: the longer one is larger. Equal length: lexicographic order equals numeric order, since
 * separators sit in the same positions.
 *
 * No sign is represented. Every input is a non-negative count (totals, followers, balances,
 * metrics). A signed consumer would need a sign axis, but adding it now would create a branch
 * nothing reaches.
 */
export function countRollDirection(
	previous: string,
	next: string,
): CountRollDirection {
	const before = significant(digitsOf(previous));
	const after = significant(digitsOf(next));
	if (before.length !== after.length)
		return after.length > before.length ? 1 : -1;
	if (before !== after) return after < before ? -1 : 1;
	return cappedNotation.test(previous) && !cappedNotation.test(next) ? -1 : 1;
}

/**
 * Time for one cell to enter, per cadence: the enter duration of the matching transition. The app
 * transition files already roll with these tokens (motionDurationMs.normal and
 * motionContinuousDurationMs.enter), so this points at the same tokens rather than restating them.
 */
const COUNT_ROLL_ENTER_MS: Record<CountRollCadence, number> = {
	default: motionDurationMs.normal,
	continuous: motionContinuousDurationMs.enter,
};

/**
 * Whether this change has time to roll. Returns false when the time since the previous change is
 * shorter than the cadence's enter duration.
 *
 * Why: a roll remounts the changed cell, and the new glyph starts transparent. If the next value
 * arrives before that glyph has entered, the cell remounts again. While a slider or a held arrow
 * key emits one value per frame, the ones digit stays nearly invisible for the whole gesture.
 *
 * Bursts replace the value immediately; only isolated changes roll. The final value of a burst is
 * not rolled in either, since it is already in place and is not rewound.
 *
 * The threshold is the cadence's enter time on purpose. Human typing (about eight characters per
 * second, 125 ms apart) is slower than the 100 ms continuous cadence, so normal typing still rolls.
 * Paste and auto-repeat, which a person cannot produce one character at a time, are gated.
 *
 * Takes elapsed time, not a clock: this package never reads time. The first change passes Infinity.
 */
export function countRollHasTime(
	elapsedMs: number,
	cadence: CountRollCadence,
): boolean {
	return !(elapsedMs < COUNT_ROLL_ENTER_MS[cadence]);
}
