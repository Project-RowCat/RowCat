import { motionDurationMs, motionEasing } from "@rowcat/design";
import { describe, expect, it } from "vitest";
import {
	backdropMotion,
	checkboxIndicatorRhythm,
	checkboxTickDrawRhythm,
	dialogMotion,
	menuIndicatorRhythm,
	type PopupSide,
	popupClosed,
	popupMotion,
	popupOpen,
	primitivePopupTransition,
	resolveDialogPlacement,
	switchRhythm,
	tabsIndicatorRhythm,
	toastContentRhythm,
	toastRhythm,
} from "./primitive-motion.ts";

/**
 * Locks the motion table for primitives as values. Three contracts are guarded: the side a popup
 * opens from, rhythm coming from tokens, and every state animating opacity.
 *
 * Opacity is the least visible and most costly one. Base UI waits for element.getAnimations() to
 * finish before unmounting a popup. A motion without opacity is invisible to that check, so the
 * exit is cut off or the popup stays open. Both failures are silent.
 */

const SIDES: PopupSide[] = [
	"top",
	"bottom",
	"left",
	"right",
	"inline-start",
	"inline-end",
];

describe("popups enter from the trigger side", () => {
	it.each([
		["bottom", "y", -1],
		["top", "y", 1],
		["left", "x", 1],
		["right", "x", -1],
		["inline-start", "x", 1],
		["inline-end", "x", -1],
	] as const)("a popup on %s has %s in direction %d", (side, axis, sign) => {
		const closed = popupClosed(side) as Record<string, number>;
		expect(Math.sign(closed[axis])).toBe(sign);
		/** The perpendicular axis must not move. No popup enters diagonally. */
		expect(closed[axis === "x" ? "y" : "x"]).toBe(0);
	});

	it("the open state rests in place from any side", () => {
		expect(popupOpen).toMatchObject({ opacity: 1, scale: 1, x: 0, y: 0 });
	});
});

describe("motion Base UI can wait for", () => {
	it.each(SIDES)("%s: both open and closed states have opacity", (side) => {
		for (const open of [true, false]) {
			const { initial, animate } = popupMotion(side, open);
			expect(initial).toHaveProperty("opacity");
			expect(animate).toHaveProperty("opacity");
		}
	});

	it("dialogs and backdrops too", () => {
		for (const placement of ["center", "bottom", "left"] as const) {
			for (const open of [true, false]) {
				expect(dialogMotion(placement, open).animate).toHaveProperty("opacity");
			}
		}
		expect(backdropMotion(true).animate).toMatchObject({ opacity: 1 });
		expect(backdropMotion(false).animate).toMatchObject({ opacity: 0 });
	});
});

describe("rhythm comes from tokens", () => {
	it("writes no primitive duration literal", () => {
		expect(primitivePopupTransition.duration).toBe(
			motionDurationMs.primitive / 1000,
		);
	});

	it("every primitive uses the same transition", () => {
		expect(popupMotion("bottom", true).transition).toBe(
			primitivePopupTransition,
		);
		expect(dialogMotion("center", true).transition).toBe(
			primitivePopupTransition,
		);
		expect(backdropMotion(true).transition).toBe(primitivePopupTransition);
	});
});

describe("dialogs keep their placement transform", () => {
	it("`adaptive` splits only where width splits", () => {
		expect(resolveDialogPlacement("adaptive", true)).toBe("center");
		expect(resolveDialogPlacement("adaptive", false)).toBe("bottom");
		expect(resolveDialogPlacement("center", false)).toBe("center");
		expect(resolveDialogPlacement("left", true)).toBe("left");
	});

	/**
	 * The three assertions here matter most. The center dialog and bottom sheet sit at left-1/2 and
	 * pull back half their width with a translate. That translate is Motion's transform. If it is
	 * missing in one state, the box slides half off screen during that transition. The layout breaks,
	 * not just the animation.
	 */
	it.each([
		"center",
		"bottom",
	] as const)("%s has the horizontal reset in all three states", (placement) => {
		for (const open of [true, false]) {
			const { initial, animate } = dialogMotion(placement, open);
			expect(initial).toMatchObject({ x: "-50%" });
			expect(animate).toMatchObject({ x: "-50%" });
		}
	});

	it("only the centered box also resets vertically", () => {
		expect(dialogMotion("center", true).animate).toMatchObject({ y: "-50%" });
		expect(dialogMotion("bottom", true).animate).toMatchObject({ y: 0 });
	});

	it("edge drawers enter horizontally without scaling", () => {
		const { initial, animate } = dialogMotion("left", true);
		expect(initial).not.toHaveProperty("scale");
		expect(animate).not.toHaveProperty("scale");
		expect(Math.sign((initial as { x: number }).x)).toBe(-1);
		expect(animate).toMatchObject({ x: 0 });
	});
});

/**
 * CSS-driven motions take their values from the same source. The mistake guarded here is writing
 * milliseconds and bezier curves into class strings because the transition is CSS. Those values do
 * not follow token changes, and the drift only shows when the two controls are compared side by
 * side. feedback.test.ts guards the same thing for feature files.
 */
describe("CSS transition rhythm comes from tokens too", () => {
	it.each([
		["check mark", checkboxIndicatorRhythm, motionDurationMs.primitive],
		["check stroke", checkboxTickDrawRhythm, motionDurationMs.normal],
		["menu check mark", menuIndicatorRhythm, motionDurationMs.primitive],
		["switch", switchRhythm, motionDurationMs.primitive],
		["tab indicator", tabsIndicatorRhythm, motionDurationMs.normal],
		["toast content", toastContentRhythm, motionDurationMs.normal],
	] as const)("%s's duration matches the token", (_name, rhythm, token) => {
		expect(rhythm.transitionDuration).toBe(`${token}ms`);
	});

	/**
	 * All use `standard`. The checkbox indicator and switch change state in place. The tab indicator
	 * moves in place. The select popup and toast serve entry and exit with one curve, for the same
	 * reason as primitivePopupTransition.
	 */
	it.each([
		["check mark", checkboxIndicatorRhythm],
		["menu check mark", menuIndicatorRhythm],
		["switch", switchRhythm],
		["tab indicator", tabsIndicatorRhythm],
		["toast", toastRhythm],
		["toast content", toastContentRhythm],
	] as const)("%s's curve matches the token", (_name, rhythm) => {
		expect(rhythm.transitionTimingFunction).toBe(
			`cubic-bezier(${motionEasing.standard.join(", ")})`,
		);
	});

	/**
	 * Only the toast uses a different time per property. Its time list must line up with the class's
	 * property list (transform, opacity, height) by position. That order is this value's weakest link,
	 * so it is locked here. The surface travel uses the scale's upper bound (slow), and height settles
	 * earlier (fast).
	 */
	/**
	 * Only the stroke uses `enter`. That transition only runs inward and does not rewind on exit, so
	 * entry and exit have no reason to share a curve. The short first stroke must finish quickly, or
	 * the empty box stands still for a beat (checkboxTickDrawRhythm).
	 */
	it("the check stroke uses the enter curve", () => {
		expect(checkboxTickDrawRhythm.transitionTimingFunction).toBe(
			`cubic-bezier(${motionEasing.enter.join(", ")})`,
		);
	});

	/**
	 * The stroke finishes after the indicator. If it ended at the same time or earlier, the stroke
	 * would be hidden by the indicator's fade-in. The answer to the press (box and mark) has already
	 * finished.
	 */
	it("the stroke keeps drawing a little after the indicator appears", () => {
		expect(motionDurationMs.normal).toBeGreaterThan(motionDurationMs.primitive);
		expect(checkboxTickDrawRhythm.transitionDuration).not.toBe(
			checkboxIndicatorRhythm.transitionDuration,
		);
	});

	it("the toast's duration list follows property order", () => {
		expect(toastRhythm.transitionDuration).toBe(
			`${motionDurationMs.slow}ms, ${motionDurationMs.slow}ms, ${motionDurationMs.fast}ms`,
		);
	});

	/**
	 * The tab indicator moves position, and in this repo that axis's rhythm is already set by the app
	 * sidebar's active indicator (layoutTransition, normal). Dropping to the primitive scale would
	 * make the same action arrive at different speeds on different screens.
	 */
	it("moving indicators are slower than open/close infrastructure", () => {
		expect(motionDurationMs.normal).toBeGreaterThan(motionDurationMs.primitive);
	});

	/**
	 * Transition properties are intentionally absent. Inline styles cannot be overridden by classes,
	 * so once transition-property is in this object, the motion-reduce: variant stops working. The
	 * failure is silent and affects only users who turned on reduced motion.
	 */
	it.each([
		["check mark", checkboxIndicatorRhythm],
		["check stroke", checkboxTickDrawRhythm],
		["menu check mark", menuIndicatorRhythm],
		["tab indicator", tabsIndicatorRhythm],
		["switch", switchRhythm],
		["toast", toastRhythm],
		["toast content", toastContentRhythm],
	] as const)("%s does not freeze transition properties inline", (_name, rhythm) => {
		expect(rhythm).not.toHaveProperty("transitionProperty");
		expect(rhythm).not.toHaveProperty("transition");
	});
});
