import { describe, expect, it } from "vitest";
import {
	bindRuntimeAssetCatalog,
	createRuntimeAssetCatalogHandle,
	prepareRuntimeAssetCatalog,
	type RuntimeAssetEditorEntry,
	runtimeAssetCatalogFor,
	runtimeAssetDetail,
	unbindRuntimeAssetCatalog,
} from "./catalog.ts";
import { planRuntimeAssetCompletions } from "./completions.ts";
import { planRuntimeAssetHover } from "./hover.ts";

/**
 * Model-to-list table. The key property is draft isolation.
 *
 * Monaco's providers are global registrations per language and cannot tell which draft is open.
 * This table answers that question. If it is wrong, another draft's names appear in autocomplete,
 * and that screen raises no error.
 */

const MEDIA = (mediaId: string) =>
	`https://api.rowcat.test/v2/media/${mediaId}`;

const entry = (
	path: string,
	mediaId = `media-${path}`,
): RuntimeAssetEditorEntry => ({
	path,
	kind: "image",
	mediaId,
	mime: "image/webp",
	durationMs: null,
	width: 640,
	height: 480,
});

/**
 * Imitates the model without Monaco. This table checks only one thing: object identity.
 *
 * This file therefore proves only half of the isolation. It confirms that if the key is an object,
 * the two lists do not mix. It does not confirm the part before that: whether the editor actually
 * creates two distinct objects. While the address was built from the project path, the answer was
 * no (Monaco's model registry is global), and this file still passed. The other half is covered by
 * runtime-editor-models.test.ts (fake registry) and runtime-editor-models.monaco.test.ts (real
 * registry).
 */
const model = (): object => ({});

describe("building the list", () => {
	it("name order, and that order is the contract", () => {
		const catalog = prepareRuntimeAssetCatalog(
			[
				entry("ui/heart"),
				entry("characters/sena/smile"),
				entry("backgrounds/library"),
				entry("characters/sena/angry"),
			],
			MEDIA,
		);
		expect(catalog.entries.map((item) => item.path)).toEqual([
			"backgrounds/library",
			"characters/sena/angry",
			"characters/sena/smile",
			"ui/heart",
		]);
	});

	/**
	 * Authoring rules already prevent duplicates, but a record from another device may not have passed
	 * that check. If the same row appears twice, it is impossible to tell which item was chosen.
	 */
	it("one row per name; the first one stays", () => {
		const catalog = prepareRuntimeAssetCatalog(
			[entry("ui/heart", "media-A"), entry("ui/heart", "media-B")],
			MEDIA,
		);
		expect(catalog.entries).toHaveLength(1);
		expect(catalog.byPath.get("ui/heart")?.mediaId).toBe("media-A");
	});

	it("the detail is dimensions and format", () => {
		expect(runtimeAssetDetail(entry("ui/heart"))).toBe("640 × 480 · WebP");
	});

	it("a record with broken dimensions writes only the format", () => {
		expect(
			runtimeAssetDetail({ ...entry("ui/heart"), width: 0, height: 0 }),
		).toBe("WebP");
	});
	/**
	 * Sound is a format and a duration. If the image format label were applied, `AUDIO/MPEG` would
	 * appear, and a dimension slot showing `0 × 0` would make the row read as an error rather than
	 * information.
	 */
	it.each([
		["audio/mpeg", 102_000, "MP3 · 1:42"],
		["audio/mp4", 61_000, "M4A · 1:01"],
	])("sound %s's detail is format and length", (mime, durationMs, detail) => {
		expect(
			runtimeAssetDetail({
				...entry("audio/bgm/main"),
				kind: "audio",
				mime,
				width: null,
				height: null,
				durationMs,
			}),
		).toBe(detail);
	});
});

describe("model isolation", () => {
	it("an unbound model is `null`, distinct from an empty list", () => {
		expect(runtimeAssetCatalogFor(model())).toBeNull();
	});

	/**
	 * This test is the reason this file exists.
	 *
	 * Two models sharing the same virtual path is normal (each draft has `src/main.tsx`). If the table
	 * were keyed by path, two drafts would share one slot, and a person who opened draft A and then
	 * moved to B would see A's names in autocomplete.
	 */
	it("two models with the same path can't see each other's names", () => {
		const a = model();
		const b = model();
		const handleA = createRuntimeAssetCatalogHandle();
		const handleB = createRuntimeAssetCatalogHandle();
		handleA.current = prepareRuntimeAssetCatalog(
			[entry("characters/a/smile")],
			MEDIA,
		);
		handleB.current = prepareRuntimeAssetCatalog(
			[entry("characters/b/smile")],
			MEDIA,
		);
		bindRuntimeAssetCatalog(a, handleA);
		bindRuntimeAssetCatalog(b, handleB);

		expect(runtimeAssetCatalogFor(a)?.entries.map((item) => item.path)).toEqual(
			["characters/a/smile"],
		);
		expect(runtimeAssetCatalogFor(b)?.entries.map((item) => item.path)).toEqual(
			["characters/b/smile"],
		);

		unbindRuntimeAssetCatalog(a);
		expect(runtimeAssetCatalogFor(a)).toBeNull();
		expect(runtimeAssetCatalogFor(b)?.entries.map((item) => item.path)).toEqual(
			["characters/b/smile"],
		);

		/** A new model that takes over a discarded slot must not revive the old list. */
		const reused = model();
		expect(runtimeAssetCatalogFor(reused)).toBeNull();
	});

	/**
	 * Re-registering the provider on every image upload would show the same items twice. So only one
	 * value inside the box changes.
	 */
	it("no rebinding needed for list updates", () => {
		const target = model();
		const handle = createRuntimeAssetCatalogHandle();
		bindRuntimeAssetCatalog(target, handle);
		expect(runtimeAssetCatalogFor(target)?.entries).toEqual([]);

		handle.current = prepareRuntimeAssetCatalog([entry("ui/heart")], MEDIA);
		expect(
			runtimeAssetCatalogFor(target)?.entries.map((item) => item.path),
		).toEqual(["ui/heart"]);
	});
});

/** Live updates: upload, rename, replace, and removal appear in the next autocomplete or hover. */
describe("live list", () => {
	const SOURCE = 'asset("characters/sena/smile")';
	const cursor = SOURCE.indexOf("smile");

	it("uploading puts it in the next list", () => {
		let catalog = prepareRuntimeAssetCatalog(
			[entry("characters/sena/smile")],
			MEDIA,
		);
		expect(catalog.entries).toHaveLength(1);
		catalog = prepareRuntimeAssetCatalog(
			[entry("characters/sena/smile"), entry("characters/sena/angry")],
			MEDIA,
		);
		expect(
			planRuntimeAssetCompletions(catalog, 'asset("")', 7)?.items.map(
				(item) => item.path,
			),
		).toEqual(["characters/sena/angry", "characters/sena/smile"]);
	});

	it("renaming removes the old name and adds the new one", () => {
		const before = prepareRuntimeAssetCatalog(
			[entry("characters/sena/smile")],
			MEDIA,
		);
		const after = prepareRuntimeAssetCatalog(
			[entry("characters/sena/happy")],
			MEDIA,
		);
		expect(before.byPath.has("characters/sena/smile")).toBe(true);
		expect(after.byPath.has("characters/sena/smile")).toBe(false);
		expect(after.byPath.has("characters/sena/happy")).toBe(true);
	});

	/**
	 * Replacement does not rename. The autocomplete label stays the same; only the image and
	 * dimensions in the hover come from the new media. That asymmetry defines this operation.
	 */
	it("replacing keeps the name and changes the picture and dimensions", () => {
		const before = prepareRuntimeAssetCatalog(
			[{ ...entry("characters/sena/smile", "media-A") }],
			MEDIA,
		);
		const after = prepareRuntimeAssetCatalog(
			[
				{
					...entry("characters/sena/smile", "media-B"),
					width: 200,
					height: 100,
				},
			],
			MEDIA,
		);
		expect(planRuntimeAssetHover(before, SOURCE, cursor)?.image?.url).toContain(
			"media-A",
		);
		const next = planRuntimeAssetHover(after, SOURCE, cursor);
		expect(next?.path).toBe("characters/sena/smile");
		expect(next?.image?.url).toContain("media-B");
		expect(next?.detail).toBe("200 × 100 · WebP");
	});

	it("removing takes it out of both the list and hover", () => {
		const catalog = prepareRuntimeAssetCatalog([], MEDIA);
		expect(planRuntimeAssetHover(catalog, SOURCE, cursor)).toBeNull();
		expect(planRuntimeAssetCompletions(catalog, 'asset("")', 7)?.items).toEqual(
			[],
		);
	});
});
