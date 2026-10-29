import { describe, expect, it } from "vitest";
import {
	PAGE_ENTER_Y,
	pageEnterAnimate,
	pageEnterInitial,
	pageEnterInitialFor,
} from "./page-enter.ts";

/**
 * This file checks policy, not the styles Motion produces (same rule as list-motion.test.ts).
 * Asserting the DOM properties Motion writes would break on every library upgrade and leave the
 * actual rules unchecked: the first screen does not move, and movement stays small. Real movement
 * is checked in the browser.
 */

describe("first-screen decision", () => {
	/**
	 * This single line matters. If it breaks, the server body goes out at opacity 0 and hydration
	 * mismatches. This has happened once (see page-transition.tsx).
	 */
	it("no initial value during hydration", () => {
		expect(pageEnterInitialFor(true)).toBe(false);
	});

	it("screens mounted after hydration enter", () => {
		expect(pageEnterInitialFor(false)).toEqual(pageEnterInitial);
	});
});

describe("entrance values", () => {
	it("starts transparent and becomes fully opaque", () => {
		expect(pageEnterInitial.opacity).toBe(0);
		expect(pageEnterAnimate.opacity).toBe(1);
	});

	it("ends in place; a leftover transform would drag the layout on top of it", () => {
		expect(pageEnterAnimate.y).toBe(0);
	});

	/**
	 * Pin the upper bound. A silent increase is the most common way this breaks: a few pixels per
	 * change show in no single commit, but the result is a whole page that slides on every move.
	 */
	it("the vertical move is barely noticeable", () => {
		expect(PAGE_ENTER_Y).toBeGreaterThan(0);
		expect(PAGE_ENTER_Y).toBeLessThanOrEqual(8);
		expect(pageEnterInitial.y).toBe(PAGE_ENTER_Y);
	});
});
