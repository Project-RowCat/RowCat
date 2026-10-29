import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { motionDurationMs, motionEasing } from "@rowcat/design";
import { describe, expect, it } from "vitest";
import {
	DIALOG_EDGE_SHIFT,
	drawerEnterRhythm,
	drawerExitRhythm,
	MENU_INDICATOR_SCALE,
	nativeRhythm,
	POPUP_SCALE,
	primitiveRhythm,
} from "./rhythm.ts";

/**
 * These tests check policy, not the transform Reanimated produces. This follows the same rule as
 * web's feedback.test.ts and icon-swap.test.ts. Real motion is verified on a device.
 *
 * There are four rules, and all four fail silently: the menu opens at product-motion speed, the
 * values come from two sources, reduced motion turns entirely on or off, and the drawer exception
 * takes a different value for no reason.
 */

describe("primitive scale", () => {
	/**
	 * This scale differs from product motion. Opening a menu and choosing an item is one gesture, so a
	 * visible transition between them would read as delay, not explanation. Web's same layer uses the
	 * same value.
	 */
	it("100ms · standard, with values from tokens", () => {
		expect(primitiveRhythm.transform.duration).toBe(motionDurationMs.primitive);
		expect(primitiveRhythm.opacity.duration).toBe(motionDurationMs.primitive);
		expect(primitiveRhythm.transform.easing).toEqual(motionEasing.standard);
		expect(primitiveRhythm.opacity.easing).toEqual(motionEasing.standard);
	});

	it("shorter than product motion", () => {
		expect(motionDurationMs.primitive).toBeLessThan(motionDurationMs.fast);
		expect(motionDurationMs.primitive).toBeLessThan(motionDurationMs.normal);
	});

	/**
	 * Open and close use the same curve. If they were split, the return path after a fast double press
	 * would differ from the outgoing path (web's primitivePopupTransition made the same call).
	 */
	it("open and close share a rhythm", () => {
		expect(primitiveRhythm.transform.duration).toBe(
			primitiveRhythm.opacity.duration,
		);
		expect(primitiveRhythm.transform.easing).toEqual(
			primitiveRhythm.opacity.easing,
		);
	});
});

describe("reduced motion", () => {
	/**
	 * This disables movement, not animation. Web's global MotionConfig reducedMotion="user" does
	 * exactly this: transforms snap to their final value and opacity keeps running.
	 *
	 * Folding the two axes into one breaks in either direction. If everything follows "system", people
	 * who use that setting see state change with no explanation. If everything is "never", the setting
	 * is ignored in this app.
	 */
	it("transforms follow the device setting and opacity flows", () => {
		for (const pair of [primitiveRhythm, drawerEnterRhythm, drawerExitRhythm]) {
			expect(pair.transform.reduceMotion).toBe("system");
			expect(pair.opacity.reduceMotion).toBe("never");
		}
	});

	/**
	 * Both axes must share duration and curve. If they differ, transform can finish while opacity
	 * lingers, or the reverse.
	 */
	it("both axes share duration and curve", () => {
		const pair = nativeRhythm(motionDurationMs.normal, motionEasing.enter);
		expect(pair.transform.duration).toBe(pair.opacity.duration);
		expect(pair.transform.easing).toEqual(pair.opacity.easing);
	});
});

describe("the drawer is an intended exception", () => {
	it("enter is normal · enter, exit is fast · exit", () => {
		expect(drawerEnterRhythm.transform.duration).toBe(motionDurationMs.normal);
		expect(drawerEnterRhythm.transform.easing).toEqual(motionEasing.enter);
		expect(drawerExitRhythm.transform.duration).toBe(motionDurationMs.fast);
		expect(drawerExitRhythm.transform.easing).toEqual(motionEasing.exit);
	});

	/**
	 * Exit is faster than enter, since nothing that is leaving needs to hold the eye. This inequality
	 * is a repo-wide rule.
	 */
	it("exit is faster than enter", () => {
		expect(drawerExitRhythm.transform.duration).toBeLessThan(
			drawerEnterRhythm.transform.duration,
		);
	});
});

describe("geometry", () => {
	it("popups grow from 0.95", () => {
		expect(POPUP_SCALE).toBe(0.95);
	});

	it("edge-attached surfaces come from farther away", () => {
		expect(DIALOG_EDGE_SHIFT).toBe(16);
	});
});

describe("menu check mark", () => {
	const source = (name: string) =>
		readFileSync(fileURLToPath(new URL(name, import.meta.url)), "utf8");

	it("the entering scale matches the web", () => {
		expect(MENU_INDICATOR_SCALE).toBe(0.8);
	});

	/**
	 * Checked rows at menu open must not enter. Without the skipEntering line, checks pop in on every
	 * open. No error is raised; it simply looks as if something was just pressed.
	 */
	it("skips the indicator at the moment of opening", () => {
		const menu = source("../menu.tsx");
		expect(menu).toMatch(/<LayoutAnimationConfig skipEntering>\s*\{children\}/);
		expect(menu.match(/entering=\{menuIndicatorEnter\}/g)).toHaveLength(2);
	});
});
