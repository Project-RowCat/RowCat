import { describe, expect, it } from "vitest";
import {
	checkHapticPattern,
	HAPTIC_PATTERN_MAX_AMPLITUDE,
	HAPTIC_PATTERN_MAX_MS,
	HAPTIC_PATTERNS,
	type HapticPattern,
} from "./patterns.ts";

/**
 * Pattern rules. The feel of a pattern needs a device to judge, but the promise that it stays short
 * and quiet is checked by value. When a limit is exceeded, the check says which point broke it. If
 * the limit should rise, the reason goes next to the constant in `patterns.ts`.
 */

describe("product patterns", () => {
	it.each(
		Object.entries(HAPTIC_PATTERNS),
	)("%s is within the rules", (_, pattern) => {
		expect(checkHapticPattern(pattern)).toEqual([]);
	});

	it.each(Object.entries(HAPTIC_PATTERNS))("%s isn't empty", (_, pattern) => {
		// A pattern with no points and no continuous curve never fires. That failure is silent.
		expect(
			pattern.discretePattern.length +
				pattern.continuousPattern.amplitude.length,
		).toBeGreaterThan(0);
	});
});

describe("checkHapticPattern", () => {
	const quiet: HapticPattern = {
		discretePattern: [{ time: 10, amplitude: 0.4, frequency: 0.2 }],
		continuousPattern: { amplitude: [], frequency: [] },
	};

	it("patterns within the rules have nothing to report", () => {
		expect(checkHapticPattern(quiet)).toEqual([]);
	});

	it("catches patterns longer than the cap", () => {
		const long: HapticPattern = {
			...quiet,
			discretePattern: [
				{ time: HAPTIC_PATTERN_MAX_MS + 1, amplitude: 0.4, frequency: 0.2 },
			],
		};
		expect(checkHapticPattern(long)).toHaveLength(1);
	});

	it("catches points stronger than the cap and continuous textures", () => {
		const loud: HapticPattern = {
			discretePattern: [
				{
					time: 0,
					amplitude: HAPTIC_PATTERN_MAX_AMPLITUDE + 0.1,
					frequency: 0.2,
				},
			],
			continuousPattern: {
				amplitude: [{ time: 0, value: HAPTIC_PATTERN_MAX_AMPLITUDE + 0.1 }],
				frequency: [],
			},
		};
		expect(checkHapticPattern(loud)).toHaveLength(2);
	});

	it("catches values outside 0–1 — sharpness too", () => {
		const broken: HapticPattern = {
			discretePattern: [{ time: 0, amplitude: -0.1, frequency: 1.2 }],
			continuousPattern: { amplitude: [], frequency: [{ time: 0, value: 2 }] },
		};
		expect(checkHapticPattern(broken)).toHaveLength(3);
	});

	it("catches time going backwards", () => {
		const backwards: HapticPattern = {
			discretePattern: [],
			continuousPattern: {
				amplitude: [
					{ time: 50, value: 0.2 },
					{ time: 10, value: 0 },
				],
				frequency: [],
			},
		};
		expect(checkHapticPattern(backwards)).toEqual([
			"continuous intensity's time goes backwards",
		]);
	});

	it("doesn't let NaN through", () => {
		const nan: HapticPattern = {
			discretePattern: [{ time: Number.NaN, amplitude: 0.2, frequency: 0.2 }],
			continuousPattern: { amplitude: [], frequency: [] },
		};
		expect(checkHapticPattern(nan).length).toBeGreaterThan(0);
	});
});
