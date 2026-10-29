import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { FEEDBACK_ENTER_Y, feedbackEnter, feedbackExit } from "./feedback.ts";
import { ROW_ENTER_Y } from "./list-motion.ts";

/**
 * This checks policy, not the styles Motion emits (same rule as list-motion.test.ts and
 * page-enter.test.ts). Real motion is checked in the browser. There are four rules, and each fails
 * silently: the failure text takes longer to disappear than to arrive, its movement grows large,
 * the press guard depends on frames, or the rhythm gets two owners.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WEB_SRC = join(HERE, "..", "..");
const MOTION_LIB = join("lib", "motion");
/**
 * Generated. This is document body text derived from docs/, not this app's motion. The question
 * this rule answers is whether feature code hand-writes the app shell's rhythm. A transition
 * example such as transition={{ duration: 180 }} in the creator-runtime docs belongs to a different
 * contract, whose values belong to the creator's work and not to @rowcat/design. Without this
 * exclusion, writing a transition example in those docs would break this check.
 */
const GENERATED = "generated";

function sourceFiles(): string[] {
	const files: string[] = [];
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (entry.name === "node_modules") continue;
				walk(full);
				continue;
			}
			if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
			if (entry.name.includes(".test.")) continue;
			files.push(full);
		}
	};
	walk(WEB_SRC);
	return files;
}

const featureFiles = () =>
	sourceFiles().filter((file) => {
		const path = relative(WEB_SRC, file);
		return !path.startsWith(MOTION_LIB) && !path.startsWith(GENERATED);
	});

describe("sentences that attach and detach", () => {
	/**
	 * A leaving sentence is not worth watching. If this inequality flipped, removing a failure message
	 * would take longer than the failure took to arrive.
	 */
	it("exit is faster than entrance", () => {
		const exit = feedbackExit.transition.duration;
		const enter = feedbackEnter.transition.duration;
		// Both must be durations for this comparison to mean anything. If one became a spring, duration
		// would disappear and this test would silently check nothing.
		expect(typeof exit).toBe("number");
		expect(typeof enter).toBe("number");
		expect(exit as number).toBeLessThan(enter as number);
	});

	/**
	 * When the exiting side moves, the items that flow in to fill its place mix in its direction. The
	 * exit therefore has no movement, for the same reason as rowExit.
	 */
	it("only opacity changes on exit", () => {
		expect(feedbackExit.opacity).toBe(0);
		expect(feedbackExit).not.toHaveProperty("y");
		expect(feedbackExit).not.toHaveProperty("scale");
	});

	/**
	 * The press guard is not put on the animation target. Values set there apply when the animation
	 * starts, so they never apply in a tab without frames. This rhythm's target is a sentence with
	 * nothing to press, so if this property appears, the wrong target was chosen. What is needed then
	 * is rowExit plus useExitGuard().
	 */
	it("press protection is not on the animation target", () => {
		expect(feedbackExit).not.toHaveProperty("pointerEvents");
		expect(feedbackEnter.initial).not.toHaveProperty("pointerEvents");
	});

	it("ends in place; a leftover transform would drag what is below", () => {
		expect(feedbackEnter.animate.y).toBe(0);
		expect(feedbackEnter.animate.opacity).toBe(1);
	});

	/**
	 * Caps the vertical distance. A silently growing number is the most common way this transition
	 * breaks: if the failure message starts demanding attention, the text that should be read gets
	 * read late. It must not exceed one line (4px).
	 */
	it("the vertical move is barely noticeable", () => {
		expect(FEEDBACK_ENTER_Y).toBeGreaterThan(0);
		expect(FEEDBACK_ENTER_Y).toBeLessThanOrEqual(ROW_ENTER_Y);
		expect(feedbackEnter.initial.y).toBe(FEEDBACK_ENTER_Y);
	});
});

describe("rhythm owner", () => {
	/** If the scan finds nothing, this test passes forever, so the targets are checked first. */
	it("something really uses this rhythm", () => {
		const users = featureFiles().filter((file) =>
			readFileSync(file, "utf8").includes("exit={feedbackExit}"),
		);
		expect(users.length).toBeGreaterThan(0);
	});

	/**
	 * Core rule: feature files do not write durations or curves. ARCHITECTURE.md has said so for a
	 * long time, but nothing enforced it. The mistake has a stable shape: a new presence is written
	 * with transition={{ duration: 0.2 }} in place. Types pass and it renders. The symptom is that
	 * when the tokens change, only that spot fails to follow, and no commit makes that visible.
	 * @rowcat/design is the single source of values, and lib/motion/transitions.ts is the only place
	 * they become Motion transitions.
	 */
	it("feature files do not hand-write durations or curves", () => {
		const offenders: string[] = [];
		for (const file of featureFiles()) {
			const source = readFileSync(file, "utf8");
			if (/\bduration:\s*[\d.]/.test(source) || /\bease:\s*\[/.test(source))
				offenders.push(relative(WEB_SRC, file));
		}
		expect(offenders).toEqual([]);
	});
});
