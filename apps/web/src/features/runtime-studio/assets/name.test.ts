import type { DraftRuntimeAsset } from "@rowcat/authoring";
import { describe, expect, it } from "vitest";
import { planRuntimeAssetName, suggestRuntimeAssetName } from "./name.ts";

/**
 * Judging logical names: syntax belongs to the language contract, duplicates and counts to
 * authoring, and wording to the screen.
 *
 * This file checks the order that joins those three. If duplicates were checked on an unnormalized
 * string, `characters/a` and `Characters/a` would pass as different names. If duplicates were
 * checked before syntax, a person who typed an address would see `already exists`.
 */

const asset = (id: string, path: string): DraftRuntimeAsset => ({
	id,
	draftId: "draft-1",
	path,
	kind: "image",
	assetId: `media-${id}`,
	mime: "image/webp",
	width: 8,
	height: 8,
	durationMs: null,
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	deletedAt: null,
	dirty: 1,
	serverVersion: 0,
	rev: { t: 1, c: 0, d: "test" },
});

describe("planRuntimeAssetName", () => {
	it("passes a logical path as is", () => {
		expect(planRuntimeAssetName([], "characters/sena/smile")).toEqual({
			ok: true,
			path: "characters/sena/smile",
		});
	});

	/**
	 * Leading and trailing whitespace is trimmed before judging. It is an input mistake, and this
	 * matches the file-path normalization decision.
	 */
	it("trims surrounding whitespace before deciding", () => {
		expect(planRuntimeAssetName([], "  ui/heart  ")).toEqual({
			ok: true,
			path: "ui/heart",
		});
	});

	/**
	 * An address is not a logical asset. Its judgment is not repeated here; the language contract
	 * makes it.
	 */
	it.each([
		"https://cdn.example.com/a.png",
		"../escape",
		"has space",
		"/leading",
		"",
	])("%j is blocked by syntax", (input) => {
		const plan = planRuntimeAssetName([], input);
		expect(plan.ok).toBe(false);
		if (plan.ok) return;
		expect(plan.code).toBe("invalid_character");
	});

	it("blocked when the same name exists", () => {
		const plan = planRuntimeAssetName(
			[asset("a1", "characters/sena/smile")],
			"characters/sena/smile",
		);
		expect(plan.ok).toBe(false);
		if (!plan.ok) expect(plan.code).toBe("duplicate");
	});

	/**
	 * Case differs means a different name. The language contract is case-sensitive, so it is not
	 * folded here.
	 */
	it("different case is a different name", () => {
		expect(
			planRuntimeAssetName(
				[asset("a1", "characters/sena/smile")],
				"Characters/sena/smile",
			).ok,
		).toBe(true);
	});

	/**
	 * A name is not a duplicate of itself when renaming. Otherwise an edit that changes only the case
	 * would be blocked.
	 */
	it("itself is not a duplicate", () => {
		expect(
			planRuntimeAssetName(
				[asset("a1", "characters/sena/smile")],
				"characters/sena/smile",
				{ excludeId: "a1" },
			).ok,
		).toBe(true);
	});

	/** Syntax is checked first. A person who typed an address must not see `same name already exists`. */
	it("does not call a URL a duplicate", () => {
		const plan = planRuntimeAssetName(
			[asset("a1", "characters/sena/smile")],
			"https://cdn.example.com/a.png",
		);
		expect(plan.ok).toBe(false);
		if (!plan.ok) expect(plan.code).toBe("invalid_character");
	});
});

describe("suggestRuntimeAssetName", () => {
	it("drops the extension and adds a namespace", () => {
		expect(suggestRuntimeAssetName("sena-smile.png")).toBe("images/sena-smile");
	});

	/**
	 * Suggestions must always be names that pass validation; otherwise the first screen would open
	 * with an error.
	 */
	it.each([
		"\uC138\uB098 \uC6C3\uC74C.png",
		"...png",
		"a b c.webp",
		"__init__.jpg",
		".hidden",
		"",
	])("the suggestion for %j also passes syntax", (fileName) => {
		expect(planRuntimeAssetName([], suggestRuntimeAssetName(fileName)).ok).toBe(
			true,
		);
	});
});
