import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ICON_SWAP_SCALE } from "./icon-swap.ts";
import { LABEL_SWAP_SCALE, labelSwapIn, labelSwapOut } from "./label-swap.ts";

/**
 * This file checks policy, not the styles Motion produces (same rule as feedback.test.ts and
 * icon-swap.test.ts). Real movement is checked in the browser.
 *
 * It enforces four rules. When all four are wrong, the failure is silent: the word takes longer to
 * disappear than the new one takes to appear, the badge looks like it pops out, both words stand
 * together during the swap so assistive tech reads both, and the rhythm ends up with two owners.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WEB_SRC = join(HERE, "..", "..");

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
			if (!entry.name.endsWith(".tsx")) continue;
			if (entry.name.includes(".test.")) continue;
			files.push(full);
		}
	};
	walk(WEB_SRC);
	return files;
}

const consumers = () =>
	sourceFiles()
		.map((file) => ({
			path: relative(WEB_SRC, file),
			text: readFileSync(file, "utf8"),
		}))
		.filter((file) => file.text.includes("labelSwapIn"));

describe("words that swap in place", () => {
	/**
	 * The departing word does not need to be watched. This rhythm pairs with mode="wait", so this
	 * value is also the time the new word waits before it arrives. If the inequality flips, a badge
	 * swap would take longer than the entry itself.
	 */
	it("exit is faster than entrance", () => {
		const exit = labelSwapOut.transition.duration;
		const enter = labelSwapIn.transition.duration;
		// Both values must be written as durations for this comparison to mean anything. If one becomes a
		// spring, duration disappears and this test silently checks nothing.
		expect(typeof exit).toBe("number");
		expect(typeof enter).toBe("number");
		expect(exit as number).toBeLessThan(enter as number);
	});

	/**
	 * This indicator was already in place. Vertical movement or rotation would read as newly attached,
	 * or as a picture that turned, and neither is what this transition says.
	 */
	it("only opacity and scale move", () => {
		for (const target of [
			labelSwapIn.initial,
			labelSwapIn.animate,
			labelSwapOut,
		]) {
			expect(target).not.toHaveProperty("y");
			expect(target).not.toHaveProperty("x");
			expect(target).not.toHaveProperty("rotate");
		}
	});

	/**
	 * Pin the upper bound. Text is more sensitive to scale change than pictures are, so if this value
	 * silently deepens, the badge reads as bursting out from behind. It must not exceed the glyph
	 * value (0.8).
	 */
	it("text swaps more subtly than glyphs", () => {
		expect(LABEL_SWAP_SCALE).toBeGreaterThan(ICON_SWAP_SCALE);
		expect(LABEL_SWAP_SCALE).toBeLessThan(1);
		expect(labelSwapIn.initial.scale).toBe(LABEL_SWAP_SCALE);
		expect(labelSwapOut.scale).toBe(LABEL_SWAP_SCALE);
		expect(labelSwapIn.animate.scale).toBe(1);
	});
});

describe("rhythm owner", () => {
	/**
	 * If the scan finds nothing, the test below passes forever. That is exactly how a stale regex
	 * looks, so first check that targets exist.
	 */
	it("something really uses this rhythm", () => {
		expect(consumers().length).toBeGreaterThan(0);
	});

	/**
	 * Core rule: the swap never overlaps the old and new words, so callers must wrap it in mode="wait"
	 * (reasoning in label-swap.ts). The check exists because the mistake always looks the same: a
	 * presence is copied from a neighbouring file with mode left out. Types pass and rendering works;
	 * the symptom appears only during the 120 ms swap.
	 */
	it('swap sites prevent overlap with mode="wait"', () => {
		const offenders: string[] = [];
		for (const file of consumers()) {
			for (const block of file.text.split("<AnimatePresence").slice(1)) {
				const scope = block.split("<AnimatePresence")[0] ?? "";
				if (!scope.includes("labelSwapIn")) continue;
				const opening = scope.slice(0, scope.indexOf(">"));
				if (!opening.includes('mode="wait"')) offenders.push(file.path);
			}
		}
		expect(offenders).toEqual([]);
	});
});
