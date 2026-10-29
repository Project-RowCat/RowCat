import { describe, expect, it } from "vitest";
import {
	isBlankStartScene,
	startSceneSummary,
	untitledStartScene,
} from "./start-scene-fields.ts";

/**
 * What a collapsed start-scene card is called. The fallback text is display-only; the record still
 * stores an empty string. This test does not guard that boundary (the save path does). It guards
 * that a scene can be picked from the list.
 */
describe("collapsed opening scene card summary", () => {
	it("the title is the headline", () => {
		const summary = startSceneSummary({ title: "The library at dawn" });
		expect(summary.headline).toBe("The library at dawn");
		expect(summary.hasTitle).toBe(true);
	});

	it("without a title it folds to a word that reads as not written yet", () => {
		expect(startSceneSummary({ title: "" }).headline).toBe(
			untitledStartScene(),
		);
		// A whitespace-only title counts as no title, because it would look blank in the list.
		expect(startSceneSummary({ title: "   " }).hasTitle).toBe(false);
	});

	/** Same reason as for lore: a scene whose title equals the fallback text is still a real title. */
	it("a title equal to the fallback text is not treated as empty", () => {
		expect(startSceneSummary({ title: untitledStartScene() }).hasTitle).toBe(
			true,
		);
	});
});

describe("blank opening scene check", () => {
	it("true only when both title and body are empty", () => {
		expect(isBlankStartScene({ title: "", content: "" })).toBe(true);
		expect(isBlankStartScene({ title: " ", content: "\n" })).toBe(true);
		expect(isBlankStartScene({ title: "Dawn", content: "" })).toBe(false);
		expect(isBlankStartScene({ title: "", content: "opened the door" })).toBe(
			false,
		);
	});
});
