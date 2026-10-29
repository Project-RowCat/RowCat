import { describe, expect, it } from "vitest";
import {
	countRollCells,
	countRollDirection,
	countRollHasTime,
} from "./count-roll.ts";
import {
	COUNT_ROLL_SHIFT,
	FEEDBACK_ENTER_Y,
	ICON_SWAP_ROTATE,
	ICON_SWAP_SCALE,
	LABEL_SWAP_SCALE,
	motionContinuousDurationMs,
	motionDurationMs,
	motionEasing,
	PAGE_ENTER_Y,
	ROW_ENTER_Y,
} from "./motion.ts";

/**
 * This file checks the relationships between the motion values, not the values themselves. Web and
 * native each convert these values to their runtime shape; their adapter tests cover that
 * conversion.
 *
 * The relationships are pinned because the values tend to grow silently. A move going from 4 to 8
 * breaks no test yet changes the product's character.
 */

describe("duration hierarchy", () => {
	it("primitives are shortest and the cap is 280", () => {
		expect(motionDurationMs.primitive).toBeLessThan(motionDurationMs.fast);
		expect(motionDurationMs.fast).toBeLessThan(motionDurationMs.normal);
		expect(motionDurationMs.normal).toBeLessThan(motionDurationMs.slow);
		expect(motionDurationMs.slow).toBeLessThanOrEqual(280);
	});

	/**
	 * Exits have no reason to hold the eye. If this inequality flipped, disappearing would take longer
	 * than appearing.
	 */
	it("exit is faster than enter", () => {
		expect(motionDurationMs.fast).toBeLessThan(motionDurationMs.normal);
		expect(motionContinuousDurationMs.exit).toBeLessThan(
			motionContinuousDurationMs.enter,
		);
	});

	it("continuous values are shorter than one-off events", () => {
		expect(motionContinuousDurationMs.enter).toBeLessThan(
			motionDurationMs.normal,
		);
		expect(motionContinuousDurationMs.exit).toBeLessThan(motionDurationMs.fast);
	});
});

describe("easing", () => {
	/**
	 * Enter and exit must use different curves. If all three matched, the direction axis would be
	 * lost.
	 */
	it("the three differ", () => {
		expect(motionEasing.enter).not.toEqual(motionEasing.exit);
		expect(motionEasing.standard).not.toEqual(motionEasing.enter);
		expect(motionEasing.standard).not.toEqual(motionEasing.exit);
	});

	it("four control points with x inside the unit interval", () => {
		for (const curve of Object.values(motionEasing)) {
			expect(curve).toHaveLength(4);
			expect(curve[0]).toBeGreaterThanOrEqual(0);
			expect(curve[0]).toBeLessThanOrEqual(1);
			expect(curve[2]).toBeGreaterThanOrEqual(0);
			expect(curve[2]).toBeLessThanOrEqual(1);
		}
	});
});

describe("geometry", () => {
	/**
	 * Pins the upper bounds. Quiet growth of these numbers is the most common way this system breaks.
	 * Once a move is visible it becomes a performance rather than an explanation, and people who see
	 * it every time experience it as an obstacle.
	 */
	it("the three offsets are equal and subtle", () => {
		expect(PAGE_ENTER_Y).toBe(ROW_ENTER_Y);
		expect(FEEDBACK_ENTER_Y).toBe(ROW_ENTER_Y);
		expect(ROW_ENTER_Y).toBeGreaterThan(0);
		expect(ROW_ENTER_Y).toBeLessThanOrEqual(6);
	});

	it("words shrink much less than images", () => {
		expect(LABEL_SWAP_SCALE).toBeGreaterThan(ICON_SWAP_SCALE);
		expect(LABEL_SWAP_SCALE).toBeLessThan(1);
		expect(ICON_SWAP_SCALE).toBeGreaterThanOrEqual(0.8);
	});

	it("rotation stays within 8 degrees", () => {
		expect(ICON_SWAP_ROTATE).toBeGreaterThan(0);
		expect(ICON_SWAP_ROTATE).toBeLessThanOrEqual(8);
	});

	it("number rolls stay under half, continuous values shorter", () => {
		expect(COUNT_ROLL_SHIFT.default).toBeLessThanOrEqual(50);
		expect(COUNT_ROLL_SHIFT.continuous).toBeLessThan(COUNT_ROLL_SHIFT.default);
	});
});

describe("digits and direction are platform-independent", () => {
	it("digits count from the right", () => {
		expect(countRollCells("9", "10").map((cell) => cell.key)).toEqual([
			"1",
			"0",
		]);
		expect(countRollCells("129", "130").map((cell) => cell.changed)).toEqual([
			false,
			true,
			true,
		]);
	});

	it("the whole number decides direction", () => {
		expect(countRollDirection("199", "200")).toBe(1);
		expect(countRollDirection("200", "199")).toBe(-1);
		expect(countRollDirection("999", "1,000")).toBe(1);
		expect(countRollDirection("99+", "99")).toBe(-1);
	});

	it("an equal value changes no digit", () => {
		expect(countRollCells("1,204", "1,204").some((cell) => cell.changed)).toBe(
			false,
		);
	});
});

describe("is there time to roll", () => {
	it("the first change always rolls", () => {
		expect(countRollHasTime(Number.POSITIVE_INFINITY, "default")).toBe(true);
		expect(countRollHasTime(Number.POSITIVE_INFINITY, "continuous")).toBe(true);
	});

	it.each([
		["default", motionDurationMs.normal],
		["continuous", motionContinuousDurationMs.enter],
	] as const)("%s uses the enter duration as its threshold", (cadence, enter) => {
		expect(countRollHasTime(enter - 1, cadence)).toBe(false);
		expect(countRollHasTime(enter, cadence)).toBe(true);
	});

	/** A value arriving once per frame (about 16 ms), as while dragging a slider. */
	it("values arriving every frame do not roll", () => {
		expect(countRollHasTime(16, "continuous")).toBe(false);
	});

	/**
	 * Human typing (about eight characters per second) is slower than the threshold, so
	 * character-count rolls still run. If this fails, the enter duration of continuous was raised and
	 * typing rolls were silently disabled.
	 */
	it("ordinary keystrokes still roll", () => {
		expect(countRollHasTime(125, "continuous")).toBe(true);
	});

	/**
	 * A negative elapsed time (the clock going backwards) is treated as a burst, so the roll does not
	 * jump.
	 */
	it("negative elapsed time folds to a burst", () => {
		expect(countRollHasTime(-5, "continuous")).toBe(false);
	});
});
