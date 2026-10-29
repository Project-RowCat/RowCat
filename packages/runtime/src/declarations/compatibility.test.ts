import { describe, expect, it } from "vitest";
import {
	RUNTIME_API_COMPATIBLE_VERSIONS,
	RUNTIME_API_MIN_COMPATIBLE_VERSION,
	RUNTIME_API_VERSION,
	runtimeApiCompatibility,
} from "./index.ts";

/**
 * Compatibility-window matrix. Four consumers must give the same answer, so the judgment is one
 * function, and this table pins it down as values.
 */

describe("runtimeApiCompatibility", () => {
	it("the current version is current", () => {
		expect(runtimeApiCompatibility(RUNTIME_API_VERSION)).toBe("current");
	});

	it("older versions inside the window are compatible, down to the lower bound", () => {
		for (
			let version = RUNTIME_API_MIN_COMPATIBLE_VERSION;
			version < RUNTIME_API_VERSION;
			version += 1
		)
			expect(runtimeApiCompatibility(version)).toBe("compatible");
	});

	it("below the window is too-old: republishing is the answer", () => {
		expect(
			runtimeApiCompatibility(RUNTIME_API_MIN_COMPATIBLE_VERSION - 1),
		).toBe("too-old");
		expect(runtimeApiCompatibility(1)).toBe("too-old");
	});

	it("a version newer than the host is too-new: updating the app is the answer", () => {
		expect(runtimeApiCompatibility(RUNTIME_API_VERSION + 1)).toBe("too-new");
		expect(runtimeApiCompatibility(99)).toBe("too-new");
	});

	it("non-integers are malformed", () => {
		for (const raw of ["7", 7.5, 0, -1, Number.NaN, null, undefined, {}])
			expect(runtimeApiCompatibility(raw)).toBe("malformed");
	});

	it("old hosts refuse new artifacts: the window stands relative to the host", () => {
		/**
		 * If the host is 6, then 7 is a newer version. This is where an old app meets a newly published
		 * artifact.
		 */
		expect(runtimeApiCompatibility(7, 6)).toBe("too-new");
		expect(runtimeApiCompatibility(6, 6)).toBe("current");
	});

	it("the window's list runs from the lower bound to the current version with no gaps", () => {
		expect(RUNTIME_API_COMPATIBLE_VERSIONS[0]).toBe(
			RUNTIME_API_MIN_COMPATIBLE_VERSION,
		);
		expect(RUNTIME_API_COMPATIBLE_VERSIONS.at(-1)).toBe(RUNTIME_API_VERSION);
		expect(RUNTIME_API_COMPATIBLE_VERSIONS).toHaveLength(
			RUNTIME_API_VERSION - RUNTIME_API_MIN_COMPATIBLE_VERSION + 1,
		);
	});

	it("the window's lower bound is not above the current version", () => {
		expect(RUNTIME_API_MIN_COMPATIBLE_VERSION).toBeLessThanOrEqual(
			RUNTIME_API_VERSION,
		);
		expect(RUNTIME_API_MIN_COMPATIBLE_VERSION).toBeGreaterThan(0);
	});
});
