import { describe, expect, it } from "vitest";
import { ROW_ENTER_Y, rowEnter, rowExit } from "./list-motion.ts";

/**
 * This file checks policy, not the styles Motion produces (same rule as page-enter.test.ts). Real
 * movement is checked in the browser. Asserting interpolated transform strings would break on every
 * library upgrade and leave the rules we actually chose unchecked.
 *
 * The three rules fail silently when wrong: a deleted row is still pressable, the exit lingers
 * longer than the enter, or the movement becomes noticeably large.
 */

describe("disappearing rows", () => {
	/**
	 * The press guard must not be on this object. pointerEvents: "none" here is applied only when the
	 * animation starts, and in a tab where frames do not arrive the animation never starts. A filtered
	 * row was seen stacked over its siblings and still pressable that way. The guard belongs on
	 * presence state (useExitGuard()).
	 */
	it("press protection is not on the animation target", () => {
		expect(rowExit).not.toHaveProperty("pointerEvents");
	});

	/**
	 * Only opacity changes. If the leaving row moved, the siblings that flow in to fill its place
	 * would mix directions with it, blurring what disappeared and what moved. Movement belongs to the
	 * row that fills the gap.
	 */
	it("only opacity changes; movement belongs to whatever fills the gap", () => {
		expect(rowExit.opacity).toBe(0);
		expect(rowExit).not.toHaveProperty("y");
		expect(rowExit).not.toHaveProperty("x");
		expect(rowExit).not.toHaveProperty("scale");
	});

	/**
	 * Nothing should hold the eye on a departing row. If this inequality flips, deletion becomes
	 * slower than addition.
	 */
	it("faster than entrance", () => {
		const exit = rowExit.transition.duration;
		const enter = rowEnter.transition.duration;
		// Both durations must be numbers for this comparison to mean anything. If either becomes a
		// spring, duration disappears and this test silently checks nothing.
		expect(typeof exit).toBe("number");
		expect(typeof enter).toBe("number");
		expect(exit as number).toBeLessThan(enter as number);
	});
});

describe("entering rows", () => {
	it("ends in place; a leftover transform would drag the layout above", () => {
		expect(rowEnter.animate.y).toBe(0);
		expect(rowEnter.animate.opacity).toBe(1);
	});

	/**
	 * Pin the upper bound. The most common way this transition breaks is a value that grows silently:
	 * at 2 px per change no single commit looks wrong, but the result is a list that jumps whenever
	 * sorting changes. The row distance must not exceed the card value (6 px). List rows are wide, so
	 * the same distance reads much larger on them.
	 */
	it("the vertical move is barely noticeable", () => {
		expect(ROW_ENTER_Y).toBeGreaterThan(0);
		expect(ROW_ENTER_Y).toBeLessThanOrEqual(6);
		expect(rowEnter.initial.y).toBe(ROW_ENTER_Y);
	});
});

describe("transitions", () => {
	/**
	 * Entering and re-layout are on different axes, so they get different curves. Merging them would
	 * make a row that changes position move on the entering curve, even though the user was already
	 * looking at it.
	 */
	it("layout movement has its own curve", () => {
		expect(rowEnter.transition.layout).toBeDefined();
		expect(rowEnter.transition.layout).not.toEqual({
			duration: rowEnter.transition.duration,
			ease: rowEnter.transition.ease,
		});
	});

	/**
	 * Not a spring. Everything moving here is automatic re-layout (sort, removal, sibling selection)
	 * and nothing is being dragged. A spring on motion with nothing to imitate only makes deceleration
	 * harder to predict. Delete this test when drag or reorder arrives.
	 */
	it("written as durations; no springs yet", () => {
		expect(typeof rowEnter.transition.duration).toBe("number");
		expect(rowEnter.transition).not.toHaveProperty("stiffness");
		expect(rowExit.transition).not.toHaveProperty("stiffness");
	});
});
