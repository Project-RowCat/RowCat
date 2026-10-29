import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
	ICON_SWAP_ROTATE,
	ICON_SWAP_SCALE,
	iconSwapIn,
	iconSwapOut,
	iconSwapQuietIn,
} from "./icon-swap.ts";

/**
 * This checks policy, not the styles Motion emits (same rule as list-motion.test.ts and
 * feedback.test.ts). Real motion is checked in the browser. There are five rules, and all fail
 * silently: two glyphs stand side by side when the state changes, rotation grows into a show, the
 * reverting confirmation says success a second time, the icon floats up on its own on the first
 * screen, or motion starts to hold product state.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WEB_SRC = join(HERE, "..", "..");

const read = (path: string): string =>
	readFileSync(join(WEB_SRC, path), "utf8");

const code = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, "");

/**
 * Collapses whitespace. The scan cares what is used, not how many lines it spans. Without
 * collapsing, a formatter that wraps one more property would break the test, and the fix would land
 * in the test instead of the rule.
 */
const flat = (text: string): string => code(text).replace(/\s+/g, " ");

describe("swapping glyphs", () => {
	/**
	 * The two glyphs occupy the same cell at once, so they overlap. If this inequality flipped, the
	 * outgoing glyph would stay longer than the incoming one, and the control would briefly read as
	 * two icons.
	 */
	it("exit is faster than entrance", () => {
		const exit = iconSwapOut.transition.duration;
		const enter = iconSwapIn.transition.duration;
		// Both must be durations for this comparison to mean anything. If one became a spring, duration
		// would disappear and this test would silently check nothing.
		expect(typeof exit).toBe("number");
		expect(typeof enter).toBe("number");
		expect(exit as number).toBeLessThan(enter as number);
	});

	/**
	 * Ends in place. A leftover transform would leave the control's icon tilted or shrunk forever.
	 * That is not an animation failure but a wrongly drawn screen.
	 */
	it("ends in place", () => {
		expect(iconSwapIn.animate).toEqual({ opacity: 1, scale: 1, rotate: 0 });
	});

	/**
	 * Pins the bounds. A silently growing rotation or scale is the most common way this transition
	 * breaks: once the glyph's rotation is seen first, the transition reads as a show rather than an
	 * explanation.
	 */
	it("rotation and shrinking are barely noticeable", () => {
		expect(ICON_SWAP_ROTATE).toBeGreaterThan(0);
		expect(ICON_SWAP_ROTATE).toBeLessThanOrEqual(10);
		expect(ICON_SWAP_SCALE).toBeLessThan(1);
		expect(ICON_SWAP_SCALE).toBeGreaterThanOrEqual(0.75);
	});

	/**
	 * The signs must differ so the two glyphs appear to trade places on the same axis. The same
	 * direction would make them flow side by side.
	 */
	it("entering and exiting turn opposite ways", () => {
		expect(iconSwapIn.initial.rotate).toBe(-ICON_SWAP_ROTATE);
		expect(iconSwapOut.rotate).toBe(ICON_SWAP_ROTATE);
	});

	/**
	 * The press guard is not put on the animation target, for the same reason as in feedback.test.ts.
	 * Values there apply only when the animation starts, so never in a tab without frames. The target
	 * is decoration inside a control, not something to press; the button's [&_svg]:pointer-events-none
	 * already states that.
	 */
	it("press protection is not on the animation target", () => {
		expect(iconSwapOut).not.toHaveProperty("pointerEvents");
		expect(iconSwapIn.initial).not.toHaveProperty("pointerEvents");
	});

	/**
	 * A reverting indicator is not a response to a press. At the same weight as the original, success
	 * would seem to happen twice.
	 */
	it("the quiet variant is opacity only and shorter", () => {
		expect(iconSwapQuietIn.initial).toEqual({ opacity: 0 });
		expect(iconSwapQuietIn.animate).toEqual({ opacity: 1 });
		expect(iconSwapQuietIn.transition.duration).toBeLessThanOrEqual(
			iconSwapIn.transition.duration as number,
		);
	});
});

describe("the swapping box", () => {
	const component = read("lib/motion/animated-icon-swap.tsx");

	/**
	 * The first mount does not move. If the send icon floated up by itself when the screen arrived, it
	 * would look like the user had done something they did not. AnimatePresence owns that decision.
	 */
	it("suppresses the first mount", () => {
		expect(flat(component)).toContain("<AnimatePresence initial={false}");
	});

	/**
	 * Motion holds no product state. The moment of swap is when stateKey changes, and that value comes
	 * from facts the app already holds. If state or timers appeared here, the lifetime of the copied
	 * indicator would exist in two places and eventually diverge.
	 */
	it.each([
		"useState",
		"useRef",
		"useEffect",
		"onAnimationComplete",
		"setTimeout",
	])("has no %s", (forbidden) => {
		expect(code(component)).not.toContain(forbidden);
	});

	/**
	 * The overlap is resolved by a single grid cell. Side by side in flow, the box doubles while the
	 * glyphs overlap, and since it usually sits in a fixed-size button, the icon shifts sideways at
	 * that moment. Not using popLayout is the same axis: it measures the exiting child to position it
	 * absolutely, and that measurement reads 0 off-screen or in hidden tabs.
	 */
	it("two overlapping glyphs share one cell", () => {
		expect(flat(component)).toContain("col-start-1 row-start-1");
		expect(code(component)).not.toContain("popLayout");
		expect(code(component)).not.toContain("absolute");
	});

	/**
	 * While swapping, both glyphs are in the DOM at once. If a named graphic entered here, the same
	 * control would have two names at that instant. The name stays with the outer aria-label, which
	 * changes in the same render as the state, regardless of motion.
	 */
	it("the whole box leaves assistive tech", () => {
		expect(flat(component)).toContain('aria-hidden="true"');
	});
});

describe("rhythm owner", () => {
	/** If the scan finds nothing this test passes forever, so the targets are checked first. */
	const CONSUMERS = [
		"features/chat/composer/composer.tsx",
		"features/chat/messages/action-bar.tsx",
		"features/conversation/copy-message-action.tsx",
	];

	it.each(CONSUMERS)("%s goes through this box", (path) => {
		expect(code(read(path))).toContain("<AnimatedIconSwap");
	});

	/**
	 * Direct glyph swapping inside a control must not happen anywhere else. Otherwise the same action
	 * arrives differently on each screen, a difference visible only when two screens are compared side
	 * by side.
	 */
	it("both copy actions use the same rhythm", () => {
		for (const path of CONSUMERS.slice(1)) {
			expect(flat(read(path))).toContain(
				'<AnimatedIconSwap stateKey={copied ? "copied" : "idle"} quiet={!copied}>',
			);
		}
	});
});
