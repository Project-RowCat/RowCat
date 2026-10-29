import { describe, expect, it } from "vitest";
import {
	COUNT_ROLL_SHIFT,
	type CountRollCadence,
	countRollCells,
	countRollDirection,
	countRollIn,
	countRollOut,
} from "./count-roll.ts";

/**
 * The checks cover policy, not the styles Motion emits (same rule as list-motion.test.ts). Real
 * motion is checked in the browser. The position judgment is where values can actually be verified,
 * because wrong cell logic fails silently: unchanged digits roll along, the whole number rolls when
 * the digit count changes, or one digit moves the opposite way. None of these throws.
 */

const drawn = (previous: string, next: string) =>
	countRollCells(previous, next)
		.map((cell) => cell.character)
		.join("");

const rolled = (previous: string, next: string) =>
	countRollCells(previous, next).map((cell) => cell.changed);

describe("digit decisions", () => {
	it("what is drawn is always the current number; no invented in-between values", () => {
		// `8 to 3` must not pass through 9, 0, 1, 2. A cell knows only two glyphs, so no code exists that
		// counts between them, and accessibility depends on this fact.
		expect(drawn("8", "3")).toBe("3");
		expect(drawn("128", "129")).toBe("129");
		expect(drawn("100", "99")).toBe("99");
	});

	it("an unchanged value rolls no digit", () => {
		expect(rolled("128", "128")).toEqual([false, false, false]);
	});

	it("adding one rolls only the ones digit", () => {
		expect(rolled("128", "129")).toEqual([false, false, true]);
	});

	it("so does subtracting one", () => {
		expect(rolled("129", "128")).toEqual([false, false, true]);
	});

	it("a carry rolls only up to the carried digit", () => {
		expect(rolled("129", "130")).toEqual([false, true, true]);
	});

	it("stacked carries roll them all", () => {
		expect(rolled("199", "200")).toEqual([true, true, true]);
	});

	it("when digits grow, the new digit has nothing to exit", () => {
		const cells = countRollCells("9", "10");
		expect(cells.map((cell) => cell.character)).toEqual(["1", "0"]);
		expect(cells.map((cell) => cell.changed)).toEqual([true, true]);
		// No outgoing glyph exists at this position. If the previous string's leading digit (9) were
		// passed here, a 9 would roll out at both the tens and ones positions, creating two phantom 9s.
		expect(cells[0]?.previous).toBe("");
		expect(cells[1]?.previous).toBe("9");
	});

	it("when digits shrink, the vanished top digit has no slot", () => {
		const cells = countRollCells("100", "99");
		expect(cells).toHaveLength(2);
		expect(cells.map((cell) => cell.changed)).toEqual([true, true]);
		expect(cells.map((cell) => cell.previous)).toEqual(["0", "0"]);
	});

	/**
	 * Identity is the distance from the right. Using the array index as key shifts every cell by one
	 * on 99 to 100, so unchanged digits roll. Types and rendering both pass this mistake.
	 */
	it("the ones digit stays the ones digit when the digit count changes", () => {
		expect(countRollCells("99", "100").map((cell) => cell.key)).toEqual([
			"2",
			"1",
			"0",
		]);
		expect(countRollCells("100", "99").map((cell) => cell.key)).toEqual([
			"1",
			"0",
		]);
	});

	/**
	 * A leading zero that drops off (countdown seconds 1:09 to 1:10, and width-aligned formats).
	 * Comparing by characters makes '007' and '8' two notations of different length.
	 */
	it("counts from the right even when leading zeros come and go", () => {
		expect(drawn("007", "8")).toBe("8");
		expect(rolled("007", "8")).toEqual([true]);

		const grown = countRollCells("8", "007");
		expect(grown.map((cell) => cell.character)).toEqual(["0", "0", "7"]);
		expect(grown.map((cell) => cell.previous)).toEqual(["", "", "8"]);
		expect(grown.map((cell) => cell.changed)).toEqual([true, true, true]);
	});

	it("unchanged digits stay when the count grows", () => {
		expect(rolled("1000", "1999")).toEqual([false, true, true, true]);
		expect(rolled("999", "1999")).toEqual([true, false, false, false]);
	});
});

describe("grouping separators", () => {
	/**
	 * Three of the four consumers pass digit-separated strings (followers, gallery totals, `churu`
	 * balance). If the comma began rolling, unchanged characters would move, so every number crossing
	 * a digit boundary would waste one cell.
	 */
	it("commas hold their place and only changed digits roll", () => {
		expect(rolled("1,299", "1,300")).toEqual([
			false, // 1
			false, // ,
			true, //  2 → 3
			true, //  9 → 0
			true, //  9 → 0
		]);
		expect(drawn("1,299", "1,300")).toBe("1,300");
	});

	it("counts from the right when switching to no separator", () => {
		const cells = countRollCells("1,000", "999");
		expect(cells.map((cell) => cell.character)).toEqual(["9", "9", "9"]);
		expect(cells.map((cell) => cell.previous)).toEqual(["0", "0", "0"]);
	});

	/**
	 * When a separator appears, the new comma has no outgoing glyph. Writing it as if it had existed
	 * would roll out a character that was never there.
	 */
	it("a new separator slot has nothing to exit", () => {
		const cells = countRollCells("999", "1,000");
		expect(cells.map((cell) => cell.character)).toEqual([
			"1",
			",",
			"0",
			"0",
			"0",
		]);
		expect(cells[0]?.previous).toBe("");
		expect(cells[1]?.previous).toBe("");
	});
});

/**
 * Beyond digit separators, several unchanged characters exist. The policy grew as consumers did
 * (see 'which number rolls' in docs/motion/ARCHITECTURE.md). The countdown colon, a decimal point,
 * and the '+' of a cap notation would each roll on every tick if they moved.
 */
describe("non-digit positions", () => {
	it("a countdown's colon holds its place", () => {
		expect(rolled("1:59", "1:58")).toEqual([
			false, // 1
			false, // :
			false, // 5
			true, //  9 → 8
		]);
		expect(drawn("1:59", "1:58")).toBe("1:58");
	});

	it("the colon stays when the minute turns", () => {
		expect(rolled("2:00", "1:59")).toEqual([true, false, true, true]);
	});

	it("the colon's position counts from the right when digits shrink", () => {
		const cells = countRollCells("10:00", "9:59");
		expect(cells.map((cell) => cell.character)).toEqual(["9", ":", "5", "9"]);
		expect(cells.map((cell) => cell.previous)).toEqual(["0", ":", "0", "0"]);
		expect(cells.map((cell) => cell.changed)).toEqual([
			true,
			false,
			true,
			true,
		]);
	});

	it("the decimal point holds its place and only changed digits roll", () => {
		expect(rolled("12.4", "12.5")).toEqual([false, false, false, true]);
		expect(drawn("12.4", "12.5")).toBe("12.5");
	});

	it("the percent sign does not roll", () => {
		expect(rolled("12.4%", "13.1%")).toEqual([
			false, // 1
			true, //  2 → 3
			false, // .
			true, //  4 → 1
			false, // %
		]);
	});

	/**
	 * The cap notation (`99+`). Inside the cap the text is the same, so nothing rolls (100 to 120 are
	 * both `99+`). Crossing the boundary changes the whole value, so the changed cells roll: the '+'
	 * takes the ones position and new digit positions come in, the same rule as 99 to 100. Direction
	 * is locked by the direction group below (`99+` to `99` is a decrease).
	 */
	it("the cap's + stays only while the notation is the same", () => {
		expect(rolled("99+", "99+")).toEqual([false, false, false]);
		expect(rolled("99", "99+")).toEqual([true, false, true]);
		expect(rolled("99+", "99")).toEqual([false, true]);
	});

	/**
	 * The character-count cell rolls only the current value (the leading part of `123 / 500`). The cap
	 * never reaches this component, so there is nothing to check here. The boundary is covered by a
	 * source-scanning test in animated-count.test.ts.
	 */
	it("one keystroke rolls one digit", () => {
		expect(rolled("123", "124")).toEqual([false, false, true]);
		expect(rolled("124", "123")).toEqual([false, false, true]);
	});
});

describe("direction", () => {
	it("up when growing, down when shrinking", () => {
		expect(countRollDirection("128", "129")).toBe(1);
		expect(countRollDirection("129", "128")).toBe(-1);
	});

	/**
	 * Direction is not compared per position. In `199 to 200` the ones digit goes 9 to 0, which looks
	 * like a decrease by place value. What happened is one thing: the number went up.
	 */
	it("the whole number decides even with a carry", () => {
		expect(countRollDirection("199", "200")).toBe(1);
		expect(countRollDirection("200", "199")).toBe(-1);
	});

	it("an unchanged value has an answer too; nothing rolls then", () => {
		expect(countRollDirection("7", "7")).toBe(1);
	});

	/**
	 * This is what accepting formatted text means. Counting separators as characters, `999 to 1,000`
	 * jumps from length 3 to 5, but that is a comma, not a digit. Without stripping, the judgment
	 * flips at places like `9,999 to 10,000`.
	 */
	it("compares with separators removed", () => {
		expect(countRollDirection("999", "1,000")).toBe(1);
		expect(countRollDirection("1,000", "999")).toBe(-1);
		expect(countRollDirection("12,400", "12,380")).toBe(-1);
		expect(countRollDirection("12,380", "12,400")).toBe(1);
	});

	/**
	 * Even large jumps are not stepped through; only the direction is answered. The gallery total is
	 * this case (`128 stories` to `73 stories`).
	 */
	it("a big jump still answers one direction", () => {
		expect(countRollDirection("128", "73")).toBe(-1);
		expect(countRollDirection("73", "1,024")).toBe(1);
	});

	it("leading zeros are not counted as digits", () => {
		expect(countRollDirection("007", "8")).toBe(1);
		expect(countRollDirection("8", "007")).toBe(-1);
	});

	/**
	 * The '+' of the cap notation is part of the value, not a number. Comparing only digits made `99+`
	 * to `99` count as equal and roll upward (the default direction), so a lower number arrived
	 * rising. The notation is judged only when the digits are equal.
	 */
	it("coming down below the cap is a decrease", () => {
		expect(countRollDirection("99+", "99")).toBe(-1);
		expect(countRollDirection("99", "99+")).toBe(1);
		// When the digits differ, digit count and then lexicographic order decide before any notation.
		expect(countRollDirection("99+", "98")).toBe(-1);
		expect(countRollDirection("9", "99+")).toBe(1);
	});
});

/**
 * Both cadences run through the same table. Checking only one would leave the other unconstrained.
 */
const CADENCES: CountRollCadence[] = ["default", "continuous"];

describe("rhythm", () => {
	it.each(
		CADENCES,
	)("entering and exiting characters flow the same way (%s)", (cadence) => {
		const shift = COUNT_ROLL_SHIFT[cadence];
		const up = { in: countRollIn(1, cadence), out: countRollOut(1, cadence) };
		expect(up.in.initial.y).toBe(`${shift}%`);
		expect(up.out.animate.y).toBe(`${-shift}%`);

		const down = {
			in: countRollIn(-1, cadence),
			out: countRollOut(-1, cadence),
		};
		expect(down.in.initial.y).toBe(`${-shift}%`);
		expect(down.out.animate.y).toBe(`${shift}%`);
	});

	it.each(
		CADENCES,
	)("ends in place; a leftover transform would leave the character below misaligned (%s)", (cadence) => {
		expect(countRollIn(1, cadence).animate.y).toBe("0%");
		expect(countRollIn(1, cadence).animate.opacity).toBe(1);
	});

	/**
	 * An outgoing glyph has no reason to hold attention (same rule as rowExit). If this inequality
	 * flips, the old number stays longer than the new one. Checked for each cadence: a continuous
	 * entry at 100 paired with a fast exit at 120 would silently invert the relation, and no type or
	 * render catches it. That is why motionContinuousDurationMs in
	 * @rowcat/design exists as a pair.
	 */
	it.each(CADENCES)("exit is faster than entrance (%s)", (cadence) => {
		const out = countRollOut(1, cadence).transition.duration;
		const enter = countRollIn(1, cadence).transition.duration;
		// Both must be durations for this comparison to mean anything. If one became a spring, duration
		// would disappear and this test would silently check nothing.
		expect(typeof out).toBe("number");
		expect(typeof enter).toBe("number");
		expect(out as number).toBeLessThan(enter as number);
	});

	/**
	 * The heart (scale 1.18) is the response to the action, and the number follows it. Adding scale or
	 * rotation here would make the two motions compete at a similar size. A spring (bounce) falls in
	 * the same category.
	 */
	it.each(CADENCES)("only movement and opacity (%s)", (cadence) => {
		for (const target of [
			countRollIn(1, cadence).animate,
			countRollOut(1, cadence).animate,
		]) {
			expect(target).not.toHaveProperty("scale");
			expect(target).not.toHaveProperty("rotate");
			expect(target).not.toHaveProperty("filter");
		}
		for (const transition of [
			countRollIn(1, cadence).transition,
			countRollOut(1, cadence).transition,
		]) {
			// A spring removes duration and sets type: 'spring'. A bouncing number that ticks every second
			// is decoration, and the inequality check above would then check nothing.
			expect(transition).not.toHaveProperty("type");
			expect(transition).not.toHaveProperty("bounce");
		}
	});

	/**
	 * Pins the upper bound. A silently growing number is the most common way this transition breaks:
	 * at 100% the glyph leaves its box entirely and becomes a larger motion than the heart.
	 */
	it("the roll distance stays within half its line height", () => {
		for (const cadence of CADENCES)
			expect(COUNT_ROLL_SHIFT[cadence]).toBeLessThanOrEqual(50);
	});
});

/**
 * Cadence is the only axis that differs between the two. Without this group, 'continuous' quietly
 * becomes a second animation: a different direction, a different cell judgment, or no outgoing
 * glyph. None of this errors; it shows only on a number that ticks every second.
 */
describe("intensity", () => {
	it("a continuously changing value moves less and ends sooner", () => {
		expect(COUNT_ROLL_SHIFT.continuous).toBeLessThan(COUNT_ROLL_SHIFT.default);

		const enter = {
			base: countRollIn(1, "default").transition.duration,
			tick: countRollIn(1, "continuous").transition.duration,
		};
		const exit = {
			base: countRollOut(1, "default").transition.duration,
			tick: countRollOut(1, "continuous").transition.duration,
		};
		expect(enter.tick as number).toBeLessThan(enter.base as number);
		expect(exit.tick as number).toBeLessThan(exit.base as number);
	});

	/**
	 * Cell judgment and direction do not know the cadence; those functions take no cadence argument.
	 * The values are checked here so that a future change which passes cadence in (e.g. 'a per-tick
	 * value rolls only one digit') breaks this line first.
	 */
	it("which digits roll and their direction do not depend on intensity", () => {
		expect(rolled("1:59", "1:58")).toEqual([false, false, false, true]);
		expect(countRollDirection("1:59", "1:58")).toBe(-1);
	});

	it("both intensities share the easing", () => {
		expect(countRollIn(1, "continuous").transition.ease).toEqual(
			countRollIn(1, "default").transition.ease,
		);
		expect(countRollOut(1, "continuous").transition.ease).toEqual(
			countRollOut(1, "default").transition.ease,
		);
	});
});
