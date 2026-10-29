import { describe, expect, it } from "vitest";
import {
	CREATE_VIEWS,
	createViewParams,
	DEFAULT_CREATE_VIEW,
	readCreateViewParam,
} from "./create-view.ts";

/**
 * Tab vocabulary and address representation. Mistakes are silent: one hand-edited character turns
 * the workspace into an error screen, or a default left in the address gives one screen two
 * addresses.
 */

describe("vocabulary", () => {
	it("there are four cells", () => {
		expect([...CREATE_VIEWS]).toEqual([
			"drafts",
			"published",
			"analytics",
			"comments",
		]);
	});

	// No pre-reserved placeholder: a value only in the vocabulary becomes a row that opens nothing.
	it("no vocabulary for cells that don't exist yet", () => {
		for (const absent of ["settings", "playtest", "cover"])
			expect(CREATE_VIEWS as readonly string[]).not.toContain(absent);
	});

	it("the default is drafts — the only cell drawn without the server", () => {
		expect(DEFAULT_CREATE_VIEW).toBe("drafts");
	});
});

describe("reading the address", () => {
	it.each(CREATE_VIEWS)("reads %s as is", (view) => {
		expect(readCreateViewParam(view)).toBe(view);
	});

	it("takes the first value when it arrives as an array", () => {
		expect(readCreateViewParam(["analytics", "drafts"])).toBe("analytics");
	});

	// Never throw: one hand-edited deep link must not look like the manuscripts vanished.
	it.each([
		undefined,
		"",
		"  ",
		"PUBLISHED",
		"settings",
		"../etc",
	])("an unknown value (%p) folds to the default", (raw) => {
		expect(readCreateViewParam(raw as string | undefined)).toBe("drafts");
	});
});

describe("writing the address", () => {
	/**
	 * `setParams` merges: omitting the default keeps the previous value, so returning from `Published` to
	 * `Drafts` would not reset. Pass explicit `undefined`.
	 */
	it("the default cell is stated as undefined", () => {
		expect(createViewParams("drafts")).toEqual({ view: undefined });
		expect("view" in createViewParams("drafts")).toBe(true);
	});

	it("the rest carry their value", () => {
		expect(createViewParams("published")).toEqual({ view: "published" });
		expect(createViewParams("analytics")).toEqual({ view: "analytics" });
	});

	it("reading back the written value gives the same cell", () => {
		for (const view of CREATE_VIEWS)
			expect(readCreateViewParam(createViewParams(view).view)).toBe(view);
	});
});
