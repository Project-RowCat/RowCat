import { describe, expect, it } from "vitest";
import {
	clampRuntimeSize,
	defaultRuntimeLayout,
	parseRuntimeLayout,
	RUNTIME_LAYOUT_KEYS,
	RUNTIME_LAYOUT_LIMITS,
} from "./layout.ts";

/**
 * The size rule exists to block one unrecoverable state. A zero-width panel has no handle to grab,
 * and the value is persisted, so the studio would reopen at zero after a refresh. Users must never
 * be able to create a state they cannot leave on their own.
 */

describe("folding", () => {
	it("keeps values within range", () => {
		expect(clampRuntimeSize("explorer", 300)).toBe(300);
	});

	it("folds values outside min and max", () => {
		for (const key of RUNTIME_LAYOUT_KEYS) {
			const limits = RUNTIME_LAYOUT_LIMITS[key];
			expect(clampRuntimeSize(key, 0)).toBe(limits.min);
			expect(clampRuntimeSize(key, -9999)).toBe(limits.min);
			expect(clampRuntimeSize(key, 99_999)).toBe(limits.max);
		}
	});

	it("a non-number is the default", () => {
		expect(clampRuntimeSize("panel", Number.NaN)).toBe(
			RUNTIME_LAYOUT_LIMITS.panel.initial,
		);
		expect(clampRuntimeSize("panel", Number.POSITIVE_INFINITY)).toBe(
			RUNTIME_LAYOUT_LIMITS.panel.initial,
		);
	});

	it("rounds fractions; no fractional pixels are stored", () => {
		expect(clampRuntimeSize("explorer", 240.6)).toBe(241);
	});

	it("the default is always in range", () => {
		const layout = defaultRuntimeLayout();
		for (const key of RUNTIME_LAYOUT_KEYS) {
			expect(layout[key]).toBeGreaterThanOrEqual(
				RUNTIME_LAYOUT_LIMITS[key].min,
			);
			expect(layout[key]).toBeLessThanOrEqual(RUNTIME_LAYOUT_LIMITS[key].max);
		}
	});
});

/**
 * Stored values may come from an older version or from a hand edit in devtools. Opening at the
 * default layout is better than failing to open. The route search-param parser makes the same call.
 */
describe("reading stored values", () => {
	it("an unknown shape folds to the default layout", () => {
		for (const input of [null, undefined, "nope", 3, [], { explorer: "wide" }])
			expect(parseRuntimeLayout(input)).toEqual(defaultRuntimeLayout());
	});

	it("missing parts take defaults", () => {
		expect(parseRuntimeLayout({ explorer: 300 })).toEqual({
			...defaultRuntimeLayout(),
			explorer: 300,
		});
	});

	it("stored values out of range fold too, so a trapped layout doesn't come back", () => {
		expect(parseRuntimeLayout({ explorer: 0, preview: 0, panel: 0 })).toEqual({
			explorer: RUNTIME_LAYOUT_LIMITS.explorer.min,
			preview: RUNTIME_LAYOUT_LIMITS.preview.min,
			panel: RUNTIME_LAYOUT_LIMITS.panel.min,
		});
	});

	it("ignores extra keys", () => {
		expect(parseRuntimeLayout({ explorer: 300, sidebar: 999 })).toEqual({
			...defaultRuntimeLayout(),
			explorer: 300,
		});
	});
});
