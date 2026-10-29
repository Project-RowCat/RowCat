import { describe, expect, it } from "vitest";
import {
	BOTTOM_THRESHOLD_PX,
	getDistanceFromBottom,
	isAtBottom,
	JUMP_THRESHOLD_PX,
	shouldShowJump,
} from "./scroll-position.ts";

/**
 * Viewport distance tests. What is checked is how the distance changes over time.
 *
 * Components are not rendered. jsdom does no layout, so scrollHeight is always 0, and mounting
 * MessageList here would check the polyfill's default instead of the rule. Only the rule is
 * extracted and checked; real scrolling is verified in a browser.
 *
 * getDistanceFromBottom takes a plain object of three numbers rather than an element, since only
 * those three values are read. Requiring a real DOM would bring the problem above back.
 */

const viewport = (size: {
	scrollHeight: number;
	scrollTop: number;
	clientHeight: number;
}) => size as HTMLElement;

describe("distance to the bottom", () => {
	it("is what remains after the visible height", () => {
		expect(
			getDistanceFromBottom(
				viewport({ scrollHeight: 2000, scrollTop: 1300, clientHeight: 500 }),
			),
		).toBe(200);
	});

	it("is 0 at the bottom", () => {
		expect(
			getDistanceFromBottom(
				viewport({ scrollHeight: 2000, scrollTop: 1500, clientHeight: 500 }),
			),
		).toBe(0);
	});

	it("grows as content grows, without scrolling", () => {
		/**
		 * This is the reason for the whole file. If the user is reading 200px above the bottom and the
		 * response grows by 500px, scrollTop stays the same but the distance becomes 700px, and no scroll
		 * event fires. A button tied only to scroll events would show a stale value.
		 */
		const before = { scrollHeight: 2000, scrollTop: 1300, clientHeight: 500 };
		const after = { ...before, scrollHeight: 2500 };

		expect(getDistanceFromBottom(viewport(before))).toBe(200);
		expect(getDistanceFromBottom(viewport(after))).toBe(700);
	});
});

describe("follow decision", () => {
	it("within the threshold counts as the bottom, boundary included", () => {
		expect(isAtBottom(0)).toBe(true);
		expect(isAtBottom(BOTTOM_THRESHOLD_PX)).toBe(true);
	});

	it("past the threshold it does not", () => {
		expect(isAtBottom(BOTTOM_THRESHOLD_PX + 1)).toBe(false);
	});
});

describe("jump-to-latest indicator", () => {
	it("appears only at a distance well beyond the bottom decision", () => {
		/**
		 * The two thresholds are not collapsed into one. A button flickering across a range that never
		 * leaves the screen is more distracting than not seeing it, so there must be a 'neither' zone
		 * between 'not at bottom' and 'show the jump button'.
		 */
		expect(isAtBottom(200)).toBe(false);
		expect(shouldShowJump(200)).toBe(false);
	});

	it("not shown yet at the boundary", () => {
		expect(shouldShowJump(JUMP_THRESHOLD_PX)).toBe(false);
		expect(shouldShowJump(JUMP_THRESHOLD_PX + 1)).toBe(true);
	});

	it("turns on without scrolling when content grows past the threshold", () => {
		expect(shouldShowJump(200)).toBe(false);
		expect(shouldShowJump(500)).toBe(true);
	});

	it("stays off while following the bottom", () => {
		// While following along, scrolling moves down by the amount content grew, so the distance stays
		// within the threshold.
		expect(shouldShowJump(0)).toBe(false);
		expect(shouldShowJump(BOTTOM_THRESHOLD_PX)).toBe(false);
	});
});
