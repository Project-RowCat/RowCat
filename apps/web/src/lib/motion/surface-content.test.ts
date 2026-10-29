import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contentEnter, contentExit } from "./surface-content.ts";

/**
 * This file checks policy, not the styles Motion produces (same rule as feedback.test.ts). Real
 * movement is checked in the browser.
 *
 * The three rules fail silently when wrong: the content moves once more where the surface changed,
 * the exit lingers longer than the enter, or the rhythm ends up with two owners.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));
const WEB_SRC = join(HERE, "..", "..");
const MOTION_LIB = join("lib", "motion");

function featureFiles(): string[] {
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
			if (relative(WEB_SRC, full).startsWith(MOTION_LIB)) continue;
			files.push(full);
		}
	};
	walk(WEB_SRC);
	return files;
}

describe("surface content", () => {
	/**
	 * The target of this rhythm is the content of a surface whose geometry has already changed. If
	 * movement arrived too, the text would move inside a box that is already placed, reading as two
	 * things happening.
	 */
	it("only opacity moves, entering and exiting", () => {
		expect(contentEnter.initial).toEqual({ opacity: 0 });
		expect(contentEnter.animate).toEqual({ opacity: 1 });
		expect(contentExit.opacity).toBe(0);
		expect(contentExit).not.toHaveProperty("y");
		expect(contentExit).not.toHaveProperty("x");
		expect(contentExit).not.toHaveProperty("scale");
	});

	/** Leaving should not hold attention. This is the same inequality as the other rhythms. */
	it("exit is faster than entrance", () => {
		const exit = contentExit.transition.duration;
		const enter = contentEnter.transition.duration;
		expect(typeof exit).toBe("number");
		expect(typeof enter).toBe("number");
		expect(exit as number).toBeLessThan(enter as number);
	});

	/**
	 * No press guard here. This rhythm applies to surfaces that may have something to press, but the
	 * guard belongs on presence state, not on the animation target (exit-guard.ts).
	 */
	it("press protection is not on the animation target", () => {
		expect(contentExit).not.toHaveProperty("pointerEvents");
		expect(contentEnter.initial).not.toHaveProperty("pointerEvents");
	});

	/**
	 * If the scan finds nothing, this test passes forever. A rhythm that is defined but never used
	 * goes stale quickly, so the existence of consumers is checked first.
	 */
	it("something really uses this rhythm", () => {
		const users = featureFiles().filter((file) =>
			readFileSync(file, "utf8").includes("contentEnter"),
		);
		expect(users.length).toBeGreaterThan(0);
	});
});
