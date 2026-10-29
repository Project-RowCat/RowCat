import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
	FEEDBACK_ENTER_Y,
	ICON_SWAP_ROTATE,
	ICON_SWAP_SCALE,
	LABEL_SWAP_SCALE,
	PAGE_ENTER_Y,
	ROW_ENTER_Y,
} from "@rowcat/design";
import { describe, expect, it } from "vitest";

/**
 * Checks the policy, not the transform values Reanimated produces. The web counterparts
 * (`page-enter.test.ts`, `feedback.test.ts`, `icon-swap.test.ts`) follow the same rules. Real
 * motion is verified on device (runtime QA in `README.md`).
 *
 * This app's tests do not render screens, so checks read source shape. Values are imported from
 * `@rowcat/design` and compared against it, so a token change breaks whichever place hard-codes the
 * value by hand, not this file.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const read = (name: string): string => readFileSync(join(HERE, name), "utf8");

/** Source with comments stripped. Comments in this repo name the rule, not the code. */
const code = (text: string): string =>
	text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, "");

const transitions = code(read("transitions.ts"));
const pageEnter = code(read("page-enter.tsx"));
const feedback = code(read("feedback.tsx"));
const listMotion = code(read("list-motion.tsx"));
const iconSwap = code(read("animated-icon-swap.tsx"));
const label = code(read("animated-label.tsx"));
const count = code(read("animated-count.tsx"));
const indicator = code(read("active-indicator.tsx"));

/** Feature files outside this folder. Targets are lists sharing a slot with their empty state. */
const source = (path: string): string =>
	code(readFileSync(join(HERE, "..", "..", path), "utf8"));

describe("transitions carry the tokens as is", () => {
	/**
	 * The conversion lives in one place. If screens call `Easing.bezier` themselves, token changes
	 * stop reaching those spots. `motion-boundaries.test.ts` guards that absence.
	 */
	it("all five rhythms come from tokens", () => {
		expect(transitions).toContain("motionDurationMs.normal");
		expect(transitions).toContain("motionDurationMs.fast");
		expect(transitions).toContain("motionContinuousDurationMs.enter");
		expect(transitions).toContain("motionContinuousDurationMs.exit");
		expect(transitions).toContain("motionEasing.standard");
		expect(transitions).toContain("motionEasing.enter");
		expect(transitions).toContain("motionEasing.exit");
		/** Hand-written milliseconds would defeat the purpose of this layer. */
		expect(transitions).not.toMatch(/duration:\s*\d/);
	});

	/**
	 * In-place change and position change are different axes. Keep the names separate even when the
	 * values match, so a future reorder change touches one place (the web made the same call).
	 */
	it("standard and layout have different names", () => {
		expect(transitions).toContain("export const standardTransition");
		expect(transitions).toContain("export const layoutTransition");
	});

	/**
	 * Reduced motion turns off movement, not animation. The web's global `MotionConfig
	 * reducedMotion="user"` does this; here the policy is set per axis. Transform follows the device
	 * setting and opacity still animates.
	 */
	it("transform and opacity have different accessibility policies", () => {
		expect(transitions).toMatch(
			/transform[\s\S]{0,200}reduceMotion:\s*ReduceMotion\.System/,
		);
		expect(transitions).toMatch(
			/opacity[\s\S]{0,200}reduceMotion:\s*ReduceMotion\.Never/,
		);
	});

	/** No springs, since the web has none and no surface yet needs that physics. */
	it("no springs", () => {
		expect(transitions).not.toMatch(/withSpring|springify/);
	});
});

describe("route arrival", () => {
	/** The page is the largest surface on screen, so once its movement is visible the transition becomes staging. */
	it("moves only 4dp and the value comes from a token", () => {
		expect(PAGE_ENTER_Y).toBe(4);
		expect(pageEnter).toContain("PAGE_ENTER_Y");
		expect(pageEnter).toMatch(/translateY:\s*PAGE_ENTER_Y/);
		expect(pageEnter).toMatch(/withTiming\(0,\s*enterTransition\.transform\)/);
	});

	/**
	 * No exit. Holding the departing screen would make navigation wait for the animation, and wrapping
	 * routes in a presence would make scroll restoration and focus follow a copy.
	 */
	it("no exit", () => {
		expect(pageEnter).not.toContain("exiting");
		expect(pageEnter).not.toContain("AnimatePresence");
	});
});

describe("a sentence that appears and leaves", () => {
	it("moves only when entering", () => {
		expect(FEEDBACK_ENTER_Y).toBe(ROW_ENTER_Y);
		expect(feedback).toMatch(/translateY:\s*FEEDBACK_ENTER_Y/);
		/** If the exit moves, its direction mixes with the things flowing in to fill the gap. */
		expect(feedback).toMatch(
			/feedbackExit[\s\S]{0,240}animations:\s*\{\s*opacity/,
		);
		expect(feedback).not.toMatch(/feedbackExit[\s\S]{0,240}transform/);
	});

	it("leaving is faster than entering", () => {
		expect(feedback).toMatch(/feedbackEnter[\s\S]{0,400}enterTransition/);
		expect(feedback).toMatch(/feedbackExit[\s\S]{0,240}exitTransition/);
	});
});

describe("list rows", () => {
	it("4dp when entering, only opacity when leaving", () => {
		expect(listMotion).toMatch(/translateY:\s*ROW_ENTER_Y/);
		expect(listMotion).not.toMatch(/rowExit[\s\S]{0,240}transform/);
	});

	/** Remaining rows settle along the `layout` axis, which must stay separate from the entrance curve. */
	it("relayout uses the layout rhythm", () => {
		expect(listMotion).toContain("rowLayout");
		expect(transitions).toMatch(/rowLayout[\s\S]{0,200}layoutTransition/);
	});

	/** Staggered entrances make the list read late. The web rejected them for the same reason. */
	it("doesn't multiply delays", () => {
		expect(listMotion).not.toMatch(/delay\(/);
	});

	/**
	 * A row that empties the list has no exit, because the empty state takes its slot. On device,
	 * removing the only row ran its exit (120ms opacity) while the empty-state copy entered the same
	 * spot, so the two texts overlapped. The web has no such frame because the list and empty state
	 * are two branches of one presence with no `exit` on the leaving branch, so removing the last row
	 * removes the whole list at once. Reanimated does not remove a child's exit when its parent is
	 * removed, so the caller encodes the same result as a known fact (`exit` set to false on the last
	 * row).
	 */
	it("exit can be turned off", () => {
		expect(listMotion).toMatch(/exiting=\{exit \? rowExit : undefined\}/);
		expect(listMotion).toMatch(/exit = true/);
	});
});

/**
 * Lists whose empty state takes the same slot turn off the exit of the last row.
 *
 * They are listed here because the pairing is invisible in code: a screen draws a `rows.length ===
 * 0` branch and a `rows.map(...)` branch side by side, and nothing says they share a slot. A screen
 * that misses this shows overlap without any error, only when the last row is removed. The session
 * section is not listed because it has no empty branch (it always has one row).
 */
describe("the last row and the empty state don't overlap", () => {
	const VACATING_LISTS: readonly [string, string][] = [
		["features/persona/persona-library-section.tsx", "library.personas.length"],
		["features/account/passkeys-section.tsx", "passkeys.length"],
		["features/create/lore-section.tsx", "entries.length"],
		["features/create/scene-image-section.tsx", "images.length"],
		["features/create/start-scene-section.tsx", "scenes.length"],
	];

	it("those lists all turn off the last row's exit", () => {
		for (const [path, count] of VACATING_LISTS) {
			const text = source(path);
			expect(text, path).toContain("<MotionRow");
			expect(text, path).toContain(`exit={${count} > 1}`);
		}
	});

	/**
	 * Product state does not wait on this axis. Only the leaving visual differs here, and the delete
	 * commits in the pressed frame. If deletes ever moved into an animation-complete callback, a frame
	 * that never arrives would mean the delete never happens.
	 */
	it("deletion doesn't wait for the exit to finish", () => {
		for (const [path] of VACATING_LISTS) {
			const text = source(path);
			expect(text, path).not.toContain("onAnimationComplete");
			expect(text, path).not.toContain("runOnJS");
		}
	});
});

describe("a glyph that swaps in place", () => {
	it("the same shrink and rotation as the web, with the sign split", () => {
		expect(ICON_SWAP_SCALE).toBe(0.8);
		expect(ICON_SWAP_ROTATE).toBe(8);
		expect(iconSwap).toMatch(/scale:\s*ICON_SWAP_SCALE/);
		expect(iconSwap).toMatch(/rotate:\s*`\$\{-ICON_SWAP_ROTATE\}deg`/);
		expect(iconSwap).toMatch(/withTiming\(\s*`\$\{ICON_SWAP_ROTATE\}deg`/);
	});

	/**
	 * The first mount does not move. If the icon floated in when the screen first arrives, it would
	 * look like something happened that the user did not trigger.
	 */
	it("the first render gets no entrance", () => {
		expect(iconSwap).toMatch(/first\.current \? undefined/);
	});

	/** The revert indicator is a timer-driven change, so it stays quiet and does not announce success twice. */
	it("the quiet branch is opacity only", () => {
		expect(iconSwap).toMatch(/quietIn[\s\S]{0,200}animations:\s*\{\s*opacity/);
		expect(iconSwap).not.toMatch(/quietIn[\s\S]{0,200}transform/);
	});

	/**
	 * The box size does not change. That is why this component can be used inside virtualized
	 * conversation rows. A sizing copy plus an out-of-flow layer make that work.
	 */
	it("there's a copy that sets the size and the swapping layer is out of flow", () => {
		expect(iconSwap).toContain("sizer");
		expect(iconSwap).toContain("StyleSheet.absoluteFill");
	});

	/** If two named images overlap, the same control ends up with two names. */
	it("the box isn't in the accessibility tree", () => {
		expect(iconSwap).toContain("accessibilityElementsHidden");
		expect(iconSwap).toContain(
			'importantForAccessibility="no-hide-descendants"',
		);
	});
});

describe("a word that swaps in place", () => {
	it("shrinks much less than the glyph and has no rotation or movement", () => {
		expect(LABEL_SWAP_SCALE).toBe(0.96);
		expect(label).toContain("LABEL_SWAP_SCALE");
		expect(label).not.toMatch(/rotate/);
		expect(label).not.toMatch(/translateY/);
	});

	/**
	 * The two words are never visible together. This used to be guaranteed by keeping one text node in
	 * the tree, which cost a JS round trip mid-transition (`runOnJS` → `setState` → commit → next
	 * animation). Now both words stay mounted and the guarantee comes from ordering: the incoming
	 * segment starts only after the outgoing one ends, so no frame shows both.
	 *
	 * `exiting=` is still not used. That layer keeps an unmounting word in flow, and the box would
	 * then grow to the longer word's width.
	 */
	it("doesn't use the exit layer and holds both layers itself", () => {
		expect(label).not.toContain("exiting=");
		expect(label).toMatch(/\{track\.leaving\.node\}/);
		expect(label).toMatch(/onLayout=\{measure\}[\s\S]{0,80}\{children\}/);
	});

	/**
	 * The middle of the transition is not tied to JS. This is the most important check in the file: if
	 * `runOnJS` returns, the moment the words split is tied again to JS scheduling and React commits,
	 * and that delay shows only when the list renders once. It is a regression that does not reproduce
	 * on demand.
	 */
	it("the UI thread owns the whole swap order", () => {
		expect(label).not.toContain("runOnJS");
		expect(label).toContain("withSequence");
	});

	/**
	 * The cost of keeping the outgoing word in the tree is paid in accessibility: the readable text is
	 * always just the current value. Both platforms' hidden flags are set together, since setting only
	 * one leaks on the other.
	 */
	it("the leaving word isn't in the accessibility tree", () => {
		expect(label).toContain("accessibilityElementsHidden");
		expect(label).toContain('importantForAccessibility="no-hide-descendants"');
	});

	it("leaving is faster than entering", () => {
		expect(label).toMatch(/withTiming\(SPLIT,\s*exitTransition\.opacity\)/);
		expect(label).toMatch(/withTiming\(1,\s*enterTransition\.opacity\)/);
		/** The boundary derives from the two tokens; no hand-written milliseconds or ratios. */
		expect(label).toMatch(
			/exitTransition\.durationMs\s*\/\s*\(\s*exitTransition\.durationMs \+ enterTransition\.durationMs/,
		);
	});

	/**
	 * The space the label occupies changes once, at the boundary, and that decision lives in the
	 * worklet. The web's `mode="wait"` changes geometry when the presence owner switches (at a point
	 * where both words are transparent). Here that point is the `fade < SPLIT` boundary, and keeping
	 * that comparison inside the animated style means JS does not decide the moment.
	 *
	 * No interpolation is a rule too. The web does not drift the width over 300ms; it is a ternary,
	 * not `interpolate`.
	 */
	it("the space it takes changes abruptly at the boundary", () => {
		expect(label).toMatch(
			/marginEnd:\s*fade\.value\s*<\s*SPLIT\s*\?\s*leaving\.value\s*-\s*arriving\.value\s*:\s*0/,
		);
	});

	/**
	 * Width is not animated. This approach was ruled out on device: narrowing and then widening the
	 * box lays out the incoming word at the narrow width once, and when Reanimated widens it later,
	 * the `Text` inside is not re-laid out. The result is a badge clipped to `Pri…` (confirmed in
	 * frames). Margin does not constrain the child, so the symptom does not occur.
	 */
	it("the animation doesn't touch the width", () => {
		const animated =
			label.match(/useAnimatedStyle\(\(\)[\s\S]*?\}\)\);/g) ?? [];
		expect(animated.length).toBeGreaterThan(0);
		for (const block of animated) expect(block).not.toMatch(/\bwidth:/);
	});

	/**
	 * Both widths are known before the transition starts. The leaving width comes from the previous
	 * commit's measurement (`track.leaving.width`), and it is set on the shared value before the clock
	 * starts. If the order flipped, the first frame's margin would be computed from the previous
	 * transition's value.
	 */
	it("the leaving width settles before the clock", () => {
		const effect = label.slice(label.indexOf("useLayoutEffect"));
		const leavingAt = effect.indexOf("leaving.value =");
		const clockAt = effect.indexOf("fade.value = 0");
		expect(leavingAt).toBeGreaterThan(-1);
		expect(clockAt).toBeGreaterThan(leavingAt);
	});

	/**
	 * `useLayoutEffect` enforces the order. The incoming layer's `onLayout` is an event native sends
	 * after commit, so it arrives later than this effect. With a plain `useEffect`, the new width
	 * would arrive after the clock starts and the margin would settle one frame late.
	 */
	it("a layout effect starts the clock", () => {
		expect(label).toContain("useLayoutEffect");
	});
});

describe("a number that changes in place", () => {
	/** If the app rewrites the cell logic, direction, or distance, the same number rolls differently on two screens. */
	it("the decision comes from the shared package", () => {
		expect(count).toMatch(
			/import\s*\{[\s\S]*countRollCells[\s\S]*\}\s*from\s*"@rowcat\/design"/,
		);
		expect(count).toContain("countRollDirection");
		expect(count).toContain("COUNT_ROLL_SHIFT");
	});

	/** A value that first arrives does not roll; it does not invent a previous value that never existed. */
	it("on mount the previous value is the current value", () => {
		expect(count).toMatch(/useState\(\{\s*value,\s*previous:\s*value,/);
		expect(count).toMatch(/changedAt:\s*Number\.NEGATIVE_INFINITY/);
		expect(count).toMatch(/entering=\{cell\.changed \? enter : undefined\}/);
	});

	/**
	 * Bursts of changes are not rolled, and the decision is the **same function as on the web**. If
	 * the threshold is written again here, the two apps answer the same paste differently, and only a
	 * side-by-side comparison shows it.
	 */
	it("bursts of changes fold through the shared decision", () => {
		expect(count).toMatch(
			/import\s*\{[\s\S]*countRollHasTime[\s\S]*\}\s*from\s*"@rowcat\/design"/,
		);
		expect(count).toMatch(/previous:\s*hasTime \? shown\.value : value/);
	});

	/** Two intensities that differ only in duration. The one axis is whether a next change is coming. */
	it("both intensities use the continuous rhythm", () => {
		expect(count).toContain("continuousEnterTransition");
		expect(count).toContain("continuousExitTransition");
	});

	/** The cells are hidden from the accessibility tree; only the current number is read. */
	it("the screen reader receives only the current number", () => {
		expect(count).toMatch(/\{shown\.value\}/);
		expect(count).toContain("accessibilityElementsHidden");
	});
});

describe("active indicator", () => {
	/** There is one indicator, and its position is the frame of the currently active row. */
	it("the rhythm is the layout transition", () => {
		expect(indicator).toContain("layoutTransition");
		expect(indicator).not.toMatch(/duration:\s*\d/);
	});

	/**
	 * No second movement state. `activeKey` arrives as a value derived from the route. Creating a
	 * shadow copy here would give two answers to which item is active.
	 */
	it("doesn't create the active identity itself", () => {
		expect(indicator).not.toMatch(/previousActive|selectedForAnimation/);
		expect(indicator).toMatch(/activeKey:\s*string \| null/);
	});

	/** Active state must still be readable if the background disappears. This layer is hidden from the accessibility tree. */
	it("the indicator isn't in the accessibility tree", () => {
		expect(indicator).toContain("accessibilityElementsHidden");
		expect(indicator).toContain('pointerEvents="none"');
	});
});
