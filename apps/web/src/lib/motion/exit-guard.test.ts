import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Exit and press protection come as a pair. The mistake has a stable shape: a new list copies a
 * line from another file, keeps `exit={rowExit}`, and omits `useExitGuard()`. Types pass and it
 * renders. The symptom appears only in tabs without frames, where the removed row stays pressable
 * over its siblings and lingers longest. A row using rowExit has identity, and identity rows have
 * something to press, so there are no exceptions. A row with nothing to press has no reason to use
 * rowExit. Checks policy, not Motion internals.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WEB_SRC = join(HERE, "..", "..");

/** Files that define this rule are excluded, so the scan does not flag its own definition. */
const MOTION_LIB = join("lib", "motion");

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
			if (relative(WEB_SRC, full).startsWith(MOTION_LIB)) continue;
			files.push(full);
		}
	};
	walk(WEB_SRC);
	return files;
}

function filesWithRowExit(): Map<string, string> {
	const found = new Map<string, string>();
	for (const file of sourceFiles()) {
		const source = readFileSync(file, "utf8");
		if (!/\bexit=\{rowExit\}/.test(source)) continue;
		found.set(relative(WEB_SRC, file), source);
	}
	return found;
}

describe("press protection for exiting rows", () => {
	/**
	 * If the scan finds nothing, this test passes forever. A stale pattern looks exactly like that, so
	 * the test first checks that the targets exist.
	 */
	it("something really sets an exit", () => {
		expect(filesWithRowExit().size).toBeGreaterThan(0);
	});

	it("files using `rowExit` also use `useExitGuard()`", () => {
		const missing: string[] = [];
		for (const [file, source] of filesWithRowExit())
			if (!source.includes("useExitGuard(")) missing.push(file);
		expect(missing).toEqual([]);
	});

	/**
	 * The guard is not put on the animation target. rowExit itself is covered by a unit test
	 * (list-motion.test.ts), but a call site that sets the value by hand on the spot is not. A value
	 * set that way is never applied in a tab without frames.
	 */
	it("`pointerEvents` is not hand-added to `exit`", () => {
		const offenders: string[] = [];
		for (const file of sourceFiles()) {
			const source = readFileSync(file, "utf8");
			if (!/\bexit=\{\{[^}]*pointerEvents/.test(source)) continue;
			offenders.push(relative(WEB_SRC, file));
		}
		expect(offenders).toEqual([]);
	});
});
