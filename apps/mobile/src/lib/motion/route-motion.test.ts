import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PAGE_ENTER_Y } from "@rowcat/design";
import { describe, expect, it } from "vitest";

/**
 * Exactly one layer signals that a screen has arrived, and that layer is `PageEnter`.
 *
 * This file used to pin "keep the stack transition", on the claim that `animation: "none"` breaks
 * the iOS edge swipe. That was tested on device (react-native-screens 4.26.2, iOS 27) and proved
 * false: with the transition off, a left-edge drag moves the screen with the finger while the
 * previous screen slides in behind it with a lag. So the file now pins the opposite: the stack
 * animates nothing, and `PageEnter` runs unconditionally. See the header of `app/_layout.tsx` and
 * `docs/motion/ARCHITECTURE.md` (route arrival and runtime QA).
 *
 * Passing here does not show the two screens look alike. This app's tests do not render screens
 * (`vitest.config.ts`), so these checks read source shape only. Runtime QA decides visual parity.
 */

const SRC = fileURLToPath(new URL("../..", import.meta.url));

const read = (...parts: string[]): string =>
	readFileSync(join(SRC, ...parts), "utf8");

/** Source with comments stripped. Comments in this repo name the rule, not the code. */
const code = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

const layout = code(read("app", "_layout.tsx"));
const pageEnter = code(read("lib", "motion", "page-enter.tsx"));

describe("route arrival is spoken by one `PageEnter`", () => {
	/**
	 * The stack animates nothing. Omitting `animation` would let react-native-screens draw the
	 * platform push, which explains the same moment twice alongside `PageEnter`. A missing line is
	 * invisible in review, so the value is pinned here.
	 */
	it("the stack's transition is off", () => {
		expect(layout).toContain("<Stack");
		expect(layout).toMatch(/animation:\s*"none"/);
	});

	/**
	 * No cross-fade. `"fade"` looks most like the web, but on a full-screen stack it produces frames
	 * where two screens overlap (two headers, a search field and category row overlap for over 100ms
	 * on device). The web has no such frames.
	 */
	it("no cross-dissolve and no custom transition", () => {
		expect(layout).not.toMatch(/animation:\s*"(?!none")/);
		expect(layout).not.toMatch(/animationDuration:/);
		expect(layout).not.toMatch(/animationTypeForReplace:/);
		expect(layout).not.toMatch(/customAnimationOnSwipe/);
	});

	/**
	 * Back gesture stays enabled. Disabling the stack transition is justified by the observed gesture
	 * behavior, so turning the gesture off here would remove that justification.
	 */
	it("doesn't turn off gestures", () => {
		expect(layout).not.toMatch(/gestureEnabled:\s*false/);
		expect(layout).not.toMatch(/fullScreenGestureEnabled:\s*false/);
	});

	/**
	 * Do not rebuild the outlet's identity or lifetime. Keying by path would remount every screen on
	 * each navigation (losing scroll, focus and local state). Wrapping in a presence would keep the
	 * departing screen alive until its exit finishes, so its effects and queries keep running.
	 */
	it("neither rebuilds the navigator by key nor wraps it in presence", () => {
		expect(layout).not.toMatch(/<Stack[^>]*\bkey=/);
		expect(layout).not.toMatch(/\bAnimatePresence\b/);
		expect(layout).not.toMatch(/\bpathname\b/);
		expect(layout).not.toMatch(/react-native-reanimated/);
	});
});

describe("arrival values are the same as the web", () => {
	/**
	 * The travel is 4dp and comes from one source. The reason for the cap changed: it used to be small
	 * enough not to fight the push, and now it matches the web value.
	 */
	it("the arrival moves 4dp and comes from a token", () => {
		expect(PAGE_ENTER_Y).toBe(4);
		expect(pageEnter).toContain("PAGE_ENTER_Y");
		expect(pageEnter).not.toMatch(/translateY:\s*\d/);
	});

	/**
	 * No exit. Only the destination's entrance animates; adding an exit would make navigation wait for
	 * the animation to finish.
	 */
	it("arrival has no exit", () => {
		expect(pageEnter).not.toContain("exiting");
	});
});

describe("arrival has no condition", () => {
	/**
	 * `PageEnter` always runs. It used to animate only late-arriving bodies, to avoid overlapping the
	 * platform push. With the push gone there is nothing to overlap, and keeping the condition would
	 * make screens opened from a warm cache lose their arrival, diverging from the web (which runs
	 * this on every navigation except the first hydration, `pageEnterInitialFor`).
	 */
	it("the entrance has no condition attached", () => {
		expect(pageEnter).toMatch(/entering=\{pageEnter\}/);
		expect(pageEnter).not.toContain("useArrivedLate");
	});

	/**
	 * The boundary that carried that condition is gone. Leaving it would keep a context that nothing
	 * reads, one per route file, and nobody could say what it protects.
	 */
	it("no arrival boundary module remains", () => {
		expect(() => read("lib", "motion", "route-arrival.tsx")).toThrow();
	});

	/**
	 * Route files do not mount that boundary again. If the wiring returns, the condition comes back
	 * with it.
	 */
	it("routes don't mount that boundary", () => {
		for (const route of [
			"account.tsx",
			"chat/runtime/[storyId].tsx",
			"create/index.tsx",
			"create/[draftId].tsx",
			"creators/[creatorId].tsx",
			"settings/_layout.tsx",
			"settings/index.tsx",
			"settings/ai.tsx",
			"settings/personas.tsx",
			"stories/[storyId]/index.tsx",
			"stories/[storyId]/play.tsx",
		]) {
			const text = code(read("app", ...route.split("/")));
			expect(text, route).not.toContain("RouteArrival");
			expect(text, route).not.toContain("route-arrival");
		}
	});
});
