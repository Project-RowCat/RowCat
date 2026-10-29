/**
 * @vitest-environment jsdom
 */
import type { DraftRuntimeFile } from "@rowcat/authoring";
import { beforeAll, describe, expect, it } from "vitest";
import { waitForTokenizer } from "#/test/monaco-dom.ts";
import { createRuntimeAssetCatalogHandle } from "../assets/catalog.ts";
import {
	createRuntimeStudioModels,
	createRuntimeStudioScope,
	type RuntimeEditorModel,
} from "./models.ts";
import { configureRuntimeMonaco, TS_LANGUAGE_ID } from "./monaco-setup.ts";

/**
 * Checks the language of files the studio opens, as a value.
 *
 * It does not check that the string `typescript` was written somewhere; that proves nothing. It
 * goes through the same model creation path the editor component uses (same registry adapter, same
 * address rules), then asks what language the model is and whether its address keeps the .tsx
 * extension.
 *
 * A language mismatch fails silently: the editor opens, text shows, and saving works. What
 * disappears is coloring, diagnostics, and completion, and a screen without them looks as if it has
 * not turned on yet.
 */
describe("the runtime model's language", () => {
	let monaco: Awaited<ReturnType<typeof configureRuntimeMonaco>>;

	beforeAll(async () => {
		monaco = configureRuntimeMonaco();
		await waitForTokenizer(
			(text, language) => monaco.editor.tokenize(text, language),
			TS_LANGUAGE_ID,
		);
	}, 60_000);

	/** Builds the same adapter the editor component passes to the model layer. */
	const models = (scope = createRuntimeStudioScope("lang")) =>
		createRuntimeStudioModels({
			scope,
			registry: {
				getModel: (uri) => monaco.editor.getModel(monaco.Uri.parse(uri)),
				createModel: (content, uri) =>
					monaco.editor.createModel(
						content,
						TS_LANGUAGE_ID,
						monaco.Uri.parse(uri),
					),
			},
			catalog: createRuntimeAssetCatalogHandle(),
			onChange: () => {},
			onForget: () => {},
		});

	const file = (id: string, path: string, content = ""): DraftRuntimeFile => ({
		id,
		draftId: "draft-1",
		path,
		content,
		rev: { t: 1, c: 0, d: "test" },
		dirty: 0,
		serverVersion: 0,
		createdAt: "2026-09-04T00:00:00.000Z",
		updatedAt: "2026-09-04T00:00:00.000Z",
		deletedAt: null,
	});

	it("both `.ts` and `.tsx` are typescript", () => {
		const store = models(createRuntimeStudioScope("ids"));
		store.sync([
			file("a", "src/state.ts", "export const x = 1;"),
			file("b", "src/main.tsx", "export default () => null;"),
		]);

		for (const id of ["a", "b"]) {
			const entry = store.get(id);
			expect(entry).toBeDefined();
			const model = entry?.model as RuntimeEditorModel & {
				getLanguageId(): string;
			};
			expect(model.getLanguageId()).toBe("typescript");
		}
		store.dispose();
	});

	/**
	 * The .tsx extension must survive because the worker picks its ScriptKind from it. Folding to .ts
	 * or stripping the extension turns <Screen> into a syntax error, and that error would not be about
	 * the author's code.
	 */
	it("the model URI keeps `.tsx`, even with a scope", () => {
		const store = models(createRuntimeStudioScope("tsx"));
		store.sync([file("b", "src/main.tsx")]);
		const uri = store.get("b")?.model.uri.toString() ?? "";
		expect(uri.endsWith("/src/main.tsx")).toBe(true);
		expect(uri).toContain("__studio__/");
		store.dispose();
	});
});
