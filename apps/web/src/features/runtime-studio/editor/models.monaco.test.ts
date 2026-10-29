/**
 * @vitest-environment jsdom
 */
import type { DraftRuntimeFile } from "@rowcat/authoring";
import { beforeAll, describe, expect, it } from "vitest";
import {
	createRuntimeAssetCatalogHandle,
	prepareRuntimeAssetCatalog,
	type RuntimeAssetEditorEntry,
	runtimeAssetCatalogFor,
} from "../assets/catalog.ts";
import { planRuntimeAssetCompletions } from "../assets/completions.ts";
import {
	createRuntimeStudioModels,
	createRuntimeStudioScope,
} from "./models.ts";

/**
 * Checks the same model-identity rules against the real Monaco model registry, not a fake.
 *
 * The sibling test file fakes the registry, and that fake is only correct if three things hold:
 * - the registry is global, with one model per address
 * - creating a second model at an address throws
 * - disposing a model frees its address If any of these differ, the scope split does nothing and
 *   the tests still pass.
 *
 * So this file plugs the product's own adapter (monaco.editor.getModel and createModel) into the
 * model layer and mounts two editors side by side. It runs under jsdom because Monaco touches
 * browser globals at module load. No editor is created: only model identity is checked, which the
 * registry alone can answer.
 */

const globals = globalThis as unknown as Record<string, unknown>;
globals.CSS = { escape: (value: string) => value };
globals.matchMedia = () => ({
	matches: false,
	media: "",
	onchange: null,
	addEventListener() {},
	removeEventListener() {},
	addListener() {},
	removeListener() {},
	dispatchEvent: () => false,
});

type Monaco = typeof import("monaco-editor/editor/editor.api");
type TextModel = import("monaco-editor/editor/editor.api").editor.ITextModel;

let monaco: Monaco;

beforeAll(async () => {
	monaco = await import("monaco-editor/editor/editor.api");
}, 60_000);

const MEDIA = (mediaId: string) =>
	`https://api.rowcat.test/v2/media/${mediaId}`;

const asset = (path: string): RuntimeAssetEditorEntry => ({
	path,
	kind: "image",
	mediaId: `media-${path}`,
	mime: "image/webp",
	width: 640,
	height: 480,
	durationMs: null,
});

const MAIN = "src/main.tsx";

const file = (path: string, content: string): DraftRuntimeFile => ({
	id: "f1",
	draftId: "draft",
	path,
	content,
	createdAt: "2026-09-04T00:00:00.000Z",
	updatedAt: "2026-09-04T00:00:00.000Z",
	deletedAt: null,
	dirty: 1,
	serverVersion: 0,
	rev: { t: 0, c: 0, d: "device" },
});

/**
 * One editor, built with the product's adapter unchanged. These four lines must match the mount
 * effect in runtime-code-editor.tsx. If they differ, this file verifies wiring written here rather
 * than the product.
 */
function studio(assets: readonly RuntimeAssetEditorEntry[], content: string) {
	const changes: { fileId: string; content: string }[] = [];
	const catalog = createRuntimeAssetCatalogHandle();
	catalog.current = prepareRuntimeAssetCatalog(assets, MEDIA);
	const models = createRuntimeStudioModels<TextModel>({
		registry: {
			getModel: (uri) => monaco.editor.getModel(monaco.Uri.parse(uri)),
			createModel: (value, uri) =>
				monaco.editor.createModel(value, undefined, monaco.Uri.parse(uri)),
		},
		catalog,
		onChange: (fileId, next) => changes.push({ fileId, content: next }),
		onForget: () => {},
		scope: createRuntimeStudioScope(),
	});
	models.sync([file(MAIN, content)]);
	const entry = models.get("f1");
	if (!entry) throw new Error("no model attached");
	return { models, changes, model: entry.model };
}

const completionsFor = (model: TextModel): string[] => {
	const catalog = runtimeAssetCatalogFor(model);
	if (catalog === null) return [];
	return (
		planRuntimeAssetCompletions(catalog, 'asset("")', 7)?.items.map(
			(item) => item.path,
		) ?? []
	);
};

describe("two studios side by side: the real registry", () => {
	it("the same src/main.tsx has a different ITextModel and URI", () => {
		const a = studio([asset("characters/a/smile")], "A_SOURCE");
		const b = studio([asset("characters/b/smile")], "B_SOURCE");
		try {
			/**
			 * Warning: the old implementation fails these two lines. The address was built from the project
			 * path alone, so getModel returned the first editor's model.
			 */
			expect(a.model === b.model).toBe(false);
			expect(a.model.uri.toString() === b.model.uri.toString()).toBe(false);

			expect(monaco.editor.getModel(a.model.uri)).toBe(a.model);
			expect(monaco.editor.getModel(b.model.uri)).toBe(b.model);

			expect(completionsFor(a.model)).toEqual(["characters/a/smile"]);
			expect(completionsFor(b.model)).toEqual(["characters/b/smile"]);
		} finally {
			a.models.dispose();
			b.models.dispose();
		}
	});

	it("A's edits reach neither B's content nor B's onChange", () => {
		const a = studio([], "A_SOURCE");
		const b = studio([], "B_SOURCE");
		try {
			a.model.setValue("A_EDITED");
			expect(a.changes.at(-1)).toEqual({ fileId: "f1", content: "A_EDITED" });
			expect(b.changes).toEqual([]);
			expect(b.model.getValue()).toBe("B_SOURCE");

			b.model.setValue("B_EDITED");
			expect(b.changes.at(-1)).toEqual({ fileId: "f1", content: "B_EDITED" });
			expect(a.model.getValue()).toBe("A_EDITED");
			expect(a.changes).toHaveLength(1);
		} finally {
			a.models.dispose();
			b.models.dispose();
		}
	});

	it("B's model survives unmounting A", () => {
		const a = studio([], "A_SOURCE");
		const b = studio([asset("ui/heart")], "B_SOURCE");
		try {
			const address = a.model.uri;
			a.models.dispose();

			expect(a.model.isDisposed()).toBe(true);
			expect(monaco.editor.getModel(address)).toBeNull();
			expect(runtimeAssetCatalogFor(a.model)).toBeNull();

			expect(b.model.isDisposed()).toBe(false);
			expect(b.model.getValue()).toBe("B_SOURCE");
			expect(monaco.editor.getModel(b.model.uri)).toBe(b.model);
			expect(completionsFor(b.model)).toEqual(["ui/heart"]);
		} finally {
			b.models.dispose();
		}
	});

	/**
	 * Mirrors the rule the fake registry imitates: creating a second model at the same address throws.
	 * Without scoping, that rule forced `getModel(uri) ?? createModel(...)`, and that expression was
	 * the path by which two editors shared one model.
	 */
	it("can't create twice with the same URI", () => {
		const a = studio([], "A_SOURCE");
		try {
			expect(() =>
				monaco.editor.createModel("again", undefined, a.model.uri),
			).toThrow();
		} finally {
			a.models.dispose();
		}
	});
});
