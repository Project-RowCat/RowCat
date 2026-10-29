import { describe, expect, it } from "vitest";
import {
	countRuntimeAssetsByKind,
	EMPTY_RUNTIME_ASSET_QUERY,
	filterRuntimeAssets,
	isRuntimeAssetQueryActive,
} from "./list.ts";

const ASSETS = [
	{ id: "1", path: "audio/bgm/main", kind: "audio" as const, assetId: "m1" },
	{
		id: "2",
		path: "characters/sena/smile",
		kind: "image" as const,
		assetId: "m2",
	},
	{
		id: "3",
		path: "characters/sena/cry",
		kind: "image" as const,
		assetId: "m3",
	},
	{ id: "4", path: "ui/heart", kind: "image" as const, assetId: "sena-media" },
];

const paths = (items: readonly { path: string }[]) => items.map((a) => a.path);

describe("filterRuntimeAssets", () => {
	it("an empty filter is everything", () => {
		expect(filterRuntimeAssets(ASSETS, EMPTY_RUNTIME_ASSET_QUERY)).toEqual(
			ASSETS,
		);
	});

	it("a match anywhere in the name keeps it, in the same order", () => {
		expect(
			paths(filterRuntimeAssets(ASSETS, { text: "sena", kind: "all" })),
		).toEqual(["characters/sena/smile", "characters/sena/cry"]);
	});

	/**
	 * The name syntax is lowercase only, so someone who types uppercase and sees an empty list would
	 * read the name as absent.
	 */
	it("folds case and surrounding whitespace", () => {
		expect(
			paths(filterRuntimeAssets(ASSETS, { text: "  UI/ ", kind: "all" })),
		).toEqual(["ui/heart"]);
	});

	/**
	 * If a media identity could match, that value would start to become part of the screen's
	 * vocabulary.
	 */
	it("media identity is not matched", () => {
		expect(
			paths(filterRuntimeAssets(ASSETS, { text: "sena-media", kind: "all" })),
		).toEqual([]);
	});

	it("filters by kind", () => {
		expect(
			paths(filterRuntimeAssets(ASSETS, { text: "", kind: "audio" })),
		).toEqual(["audio/bgm/main"]);
		expect(
			paths(filterRuntimeAssets(ASSETS, { text: "a", kind: "image" })),
		).toEqual(["characters/sena/smile", "characters/sena/cry", "ui/heart"]);
	});
});

describe("countRuntimeAssetsByKind", () => {
	it("per-kind counts don't depend on the name filter", () => {
		expect(countRuntimeAssetsByKind(ASSETS)).toEqual({
			all: 4,
			image: 3,
			audio: 1,
		});
	});
});

describe("isRuntimeAssetQueryActive", () => {
	it("whitespace only is not a filter", () => {
		expect(isRuntimeAssetQueryActive({ text: "   ", kind: "all" })).toBe(false);
		expect(isRuntimeAssetQueryActive({ text: "", kind: "image" })).toBe(true);
	});
});
