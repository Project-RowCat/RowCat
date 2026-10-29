import type { DraftRuntimeFile } from "@rowcat/authoring";
import { runtimePackageFiles } from "@rowcat/runtime/declarations";
import { RUNTIME_VIRTUAL_ROOT } from "@rowcat/runtime-compiler";
import { describe, expect, it, vi } from "vitest";
import {
	createRuntimeAssetCatalogHandle,
	prepareRuntimeAssetCatalog,
	type RuntimeAssetEditorEntry,
	runtimeAssetCatalogFor,
} from "../assets/catalog.ts";
import { planRuntimeAssetCompletions } from "../assets/completions.ts";
import { planRuntimeAssetHover } from "../assets/hover.ts";
import {
	createRuntimeStudioModels,
	createRuntimeStudioScope,
	type RuntimeEditorDisposable,
	type RuntimeEditorModel,
	type RuntimeEditorRange,
	type RuntimeModelRegistry,
	type RuntimeStudioModels,
	runtimeStudioModelUri,
} from "./models.ts";

/**
 * Model identity owned by an editor. The defect this file targets is much broader than
 * autocomplete.
 *
 * Why WeakMap tests alone were not enough: the isolation test in runtime-asset-catalog.test.ts uses
 * two distinct objects as keys. That proves the table keys by object identity, which is true, but
 * it does not prove the editor creates two objects. While the address was built from the project
 * path (file://<root>/src/main.tsx), Monaco's registry was global. With two studios alive at once,
 * getModel(uri) returned the same object, leaving the table only one key, so it could separate
 * nothing.
 *
 * So these tests run product code over a fake that reproduces the registry's uniqueness semantics.
 * Against the old implementation, the first assertion (modelA !== modelB) fails immediately.
 *
 * Why not real Monaco: the web tests in this repo have no DOM (apps/web/vitest.config.ts). The
 * boundary is narrowed to RuntimeModelRegistry and the test fills it in. Address rules and the
 * ordering of ownership, rename, and disposal are all product code.
 */

class FakeModel implements RuntimeEditorModel {
	readonly uri: { toString(): string };
	disposed = false;
	private value: string;
	private listeners = new Set<() => void>();

	constructor(
		private readonly registry: FakeRegistry,
		private readonly address: string,
		value: string,
	) {
		this.value = value;
		this.uri = { toString: () => address };
	}

	getValue(): string {
		if (this.disposed) throw new Error(`disposed model read: ${this.address}`);
		return this.value;
	}

	setValue(next: string): void {
		if (this.disposed) throw new Error(`disposed model write: ${this.address}`);
		this.value = next;
		this.emit();
	}

	getFullModelRange(): RuntimeEditorRange {
		return { start: 0, end: this.value.length };
	}

	/**
	 * Calls content listeners synchronously, as Monaco does. This re-entrancy is the real condition
	 * this layer must handle.
	 */
	pushEditOperations(
		_before: null,
		operations: { range: RuntimeEditorRange; text: string }[],
		_compute: () => null,
	): unknown {
		this.setValue(operations[0]?.text ?? this.value);
		return null;
	}

	onDidChangeContent(listener: () => void): RuntimeEditorDisposable {
		this.listeners.add(listener);
		return {
			dispose: () => {
				this.listeners.delete(listener);
			},
		};
	}

	dispose(): void {
		this.disposed = true;
		this.listeners.clear();
		this.registry.forget(this.address);
	}

	/**
	 * Edits the value as if the user had typed it. This is an edit where the screen runs ahead of the
	 * record.
	 */
	type(next: string): void {
		this.value = next;
		this.emit();
	}

	private emit(): void {
		for (const listener of [...this.listeners]) listener();
	}
}

class FakeRegistry implements RuntimeModelRegistry<FakeModel> {
	readonly live = new Map<string, FakeModel>();

	getModel(uri: string): FakeModel | null {
		return this.live.get(uri) ?? null;
	}

	createModel(content: string, uri: string): FakeModel {
		/**
		 * Throws where Monaco throws when a model already exists at the address. This check is the reason
		 * this fake exists.
		 */
		if (this.live.has(uri))
			throw new Error(`model already exists for uri: ${uri}`);
		const model = new FakeModel(this, uri, content);
		this.live.set(uri, model);
		return model;
	}

	forget(uri: string): void {
		this.live.delete(uri);
	}
}

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

const file = (id: string, path: string, content: string): DraftRuntimeFile => ({
	id,
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

interface Editor {
	models: RuntimeStudioModels<FakeModel>;
	changes: { fileId: string; content: string }[];
	forgotten: string[];
	model(fileId: string): FakeModel;
}

/**
 * Creates one editor instance through the boundary the product uses.
 *
 * The scope argument exists for determinism, not as the source of identity: the product issues its
 * own scope on each mount. The point of this harness is that two editors share one registry.
 */
function mount(
	registry: FakeRegistry,
	scopeSuffix: string,
	assets: readonly RuntimeAssetEditorEntry[],
	files: readonly DraftRuntimeFile[],
): Editor {
	const changes: { fileId: string; content: string }[] = [];
	const forgotten: string[] = [];
	const catalog = createRuntimeAssetCatalogHandle();
	catalog.current = prepareRuntimeAssetCatalog(assets, MEDIA);
	const models = createRuntimeStudioModels({
		registry,
		catalog,
		onChange: (fileId, content) => changes.push({ fileId, content }),
		onForget: (fileId) => forgotten.push(fileId),
		scope: createRuntimeStudioScope(scopeSuffix),
	});
	models.sync(files);
	return {
		models,
		changes,
		forgotten,
		model: (fileId) => {
			const entry = models.get(fileId);
			if (!entry) throw new Error(`no model for ${fileId}`);
			return entry.model;
		},
	};
}

const MAIN = "src/main.tsx";

function twoStudios() {
	const registry = new FakeRegistry();
	const a = mount(
		registry,
		"aaaa",
		[asset("characters/a/smile")],
		[file("f1", MAIN, "A_SOURCE")],
	);
	const b = mount(
		registry,
		"bbbb",
		[asset("characters/b/smile")],
		[file("f1", MAIN, "B_SOURCE")],
	);
	return { registry, a, b };
}

const pathsFor = (model: RuntimeEditorModel): string[] => {
	const catalog = runtimeAssetCatalogFor(model);
	if (catalog === null) return [];
	return (
		planRuntimeAssetCompletions(catalog, 'asset("")', 7)?.items.map(
			(item) => item.path,
		) ?? []
	);
};

describe("two editors do not share models", () => {
	/**
	 * Warning: this test fails on the old implementation.
	 *
	 * While modelUri(path) ignored scope, both editors had the same address. The registry was global,
	 * so the second attach received the first editor's model, and the two toBe(false) assertions below
	 * break. The WeakMap test was green even then.
	 */
	it("the same project path has different models and URIs", () => {
		const { a, b } = twoStudios();
		expect(a.model("f1") === b.model("f1")).toBe(false);
		expect(a.model("f1").uri.toString() === b.model("f1").uri.toString()).toBe(
			false,
		);
	});

	it("the path the creator sees is still src/main.tsx", () => {
		const { a, b } = twoStudios();
		for (const editor of [a, b])
			expect(editor.models.entries().map(([, entry]) => entry.path)).toEqual([
				MAIN,
			]);
	});

	it("the URI answers ownership; it doesn't claim another's model", () => {
		const { a, b } = twoStudios();
		expect(a.models.owns(a.model("f1"))).toBe(true);
		expect(a.models.owns(b.model("f1"))).toBe(false);
		expect(b.models.owns(a.model("f1"))).toBe(false);
	});

	/** Completions come from the model, so the two editors cannot see each other's names. */
	it("image completions do not mix", () => {
		const { a, b } = twoStudios();
		expect(pathsFor(a.model("f1"))).toEqual(["characters/a/smile"]);
		expect(pathsFor(b.model("f1"))).toEqual(["characters/b/smile"]);
	});

	/**
	 * Hover resolves through the same per-model table, so editor A's code must not open editor B's
	 * media.
	 */
	it("hover does not open another's media", () => {
		const { a, b } = twoStudios();
		const source = 'asset("characters/a/smile")';
		const cursor = source.indexOf("smile");
		const catalogA = runtimeAssetCatalogFor(a.model("f1"));
		const catalogB = runtimeAssetCatalogFor(b.model("f1"));
		expect(catalogA).not.toBeNull();
		expect(catalogB).not.toBeNull();
		expect(
			catalogA && planRuntimeAssetHover(catalogA, source, cursor)?.image?.url,
		).toContain("media-characters/a/smile");
		/** For B this name does not exist, so the hover is a placeholder, not another editor's image. */
		expect(
			catalogB && planRuntimeAssetHover(catalogB, source, cursor),
		).toBeNull();
	});
});

describe("edits do not leak to the neighboring editor", () => {
	it("A's typing reaches only A", () => {
		const { a, b } = twoStudios();
		a.model("f1").type("A_EDITED");

		expect(a.changes).toEqual([{ fileId: "f1", content: "A_EDITED" }]);
		expect(b.changes).toEqual([]);
		expect(b.model("f1").getValue()).toBe("B_SOURCE");
	});

	it("so does B's typing", () => {
		const { a, b } = twoStudios();
		b.model("f1").type("B_EDITED");

		expect(b.changes).toEqual([{ fileId: "f1", content: "B_EDITED" }]);
		expect(a.changes).toEqual([]);
		expect(a.model("f1").getValue()).toBe("A_SOURCE");
	});

	/**
	 * Does not push the model until the record has caught up with the editor. Otherwise, characters
	 * just typed would be erased whenever an autosave arrives.
	 */
	it("a record that hasn't caught up does not roll back the screen", () => {
		const registry = new FakeRegistry();
		const a = mount(registry, "aaaa", [], [file("f1", MAIN, "v1")]);
		a.model("f1").type("v2");
		a.models.sync([file("f1", MAIN, "v1")]);
		expect(a.model("f1").getValue()).toBe("v2");

		/**
		 * Once the record returns to earlier content, it is the baseline again, since edits from other
		 * devices arrive that way.
		 */
		a.models.sync([file("f1", MAIN, "v2")]);
		a.models.sync([file("f1", MAIN, "v3")]);
		expect(a.model("f1").getValue()).toBe("v3");
	});
});

describe("one editor's cleanup does not kill the neighboring editor", () => {
	it("B's model, list and completions survive unmounting A", () => {
		const { registry, a, b } = twoStudios();
		const modelA = a.model("f1");
		const modelB = b.model("f1");

		a.models.dispose();

		expect(modelA.disposed).toBe(true);
		expect(runtimeAssetCatalogFor(modelA)).toBeNull();
		expect(registry.getModel(modelA.uri.toString())).toBeNull();

		expect(modelB.disposed).toBe(false);
		expect(modelB.getValue()).toBe("B_SOURCE");
		expect(registry.getModel(modelB.uri.toString())).toBe(modelB);
		expect(pathsFor(modelB)).toEqual(["characters/b/smile"]);
	});

	/** When a file disappears, its view state goes with it. The editor receives that signal. */
	it("when a file disappears, its model and bindings go with it", () => {
		const registry = new FakeRegistry();
		const a = mount(
			registry,
			"aaaa",
			[asset("ui/heart")],
			[file("f1", MAIN, "x"), file("f2", "src/state.ts", "y")],
		);
		const gone = a.model("f2");
		a.models.sync([file("f1", MAIN, "x")]);

		expect(gone.disposed).toBe(true);
		expect(runtimeAssetCatalogFor(gone)).toBeNull();
		expect(a.forgotten).toEqual(["f2"]);
		expect(a.models.get("f2")).toBeUndefined();
	});
});

/* Renames. Fixing the scope did not undo this rule. */

describe("rename", () => {
	it("unsaved content moves to the new URI", () => {
		const registry = new FakeRegistry();
		const a = mount(registry, "aaaa", [], [file("f1", MAIN, "saved")]);
		a.model("f1").type("unsaved");
		const before = a.model("f1");

		a.models.sync([file("f1", "src/app.tsx", "saved")]);

		const after = a.model("f1");
		expect(before.disposed).toBe(true);
		expect(after === before).toBe(false);
		expect(after.getValue()).toBe("unsaved");
		expect(a.models.get("f1")?.path).toBe("src/app.tsx");
		/** The new model also lives in the same scope, so renaming a file does not change the editor. */
		expect(a.models.owns(after)).toBe(true);
		expect(after.uri.toString()).toBe(a.models.uriFor("src/app.tsx"));
		expect(runtimeAssetCatalogFor(after)).not.toBeNull();
	});

	/**
	 * Warning: this is a swap of two filenames.
	 *
	 * If files were discarded and attached one at a time, the first file would move into the second
	 * file's address, which is still occupied. The shortest implementation (use the existing model if
	 * there is one) would then leave two files editing one document. Discarding before attaching
	 * prevents that state from arising.
	 */
	it("swapping paths does not make two files share one model", () => {
		const registry = new FakeRegistry();
		const a = mount(
			registry,
			"aaaa",
			[],
			[file("f1", "src/x.ts", "X"), file("f2", "src/y.ts", "Y")],
		);

		a.models.sync([file("f1", "src/y.ts", "X"), file("f2", "src/x.ts", "Y")]);

		const first = a.model("f1");
		const second = a.model("f2");
		expect(first === second).toBe(false);
		expect(first.getValue()).toBe("X");
		expect(second.getValue()).toBe("Y");
		expect(a.models.get("f1")?.path).toBe("src/y.ts");
		expect(a.models.get("f2")?.path).toBe("src/x.ts");
	});

	/**
	 * If two live records claim the same path (a record from another device may skip authoring
	 * validation), do not merge them. A file with no model is visible on screen; a merged document is
	 * not.
	 */
	it("records with overlapping paths do not share a model", () => {
		const registry = new FakeRegistry();
		const a = mount(
			registry,
			"aaaa",
			[],
			[file("f1", MAIN, "first"), file("f2", MAIN, "second")],
		);
		expect(a.models.get("f1")?.model.getValue()).toBe("first");
		expect(a.models.get("f2")).toBeUndefined();
	});
});

describe("scope stability", () => {
	it("feeding the same list again keeps the models", () => {
		const registry = new FakeRegistry();
		const files = [file("f1", MAIN, "x")];
		const a = mount(registry, "aaaa", [], files);
		const model = a.model("f1");
		a.models.sync(files);
		a.models.sync([file("f1", MAIN, "x")]);
		expect(a.model("f1")).toBe(model);
		expect(model.disposed).toBe(false);
	});

	it("the models stay when the image list changes", () => {
		const registry = new FakeRegistry();
		const catalog = createRuntimeAssetCatalogHandle();
		catalog.current = prepareRuntimeAssetCatalog([], MEDIA);
		const models = createRuntimeStudioModels({
			registry,
			catalog,
			onChange: () => {},
			onForget: () => {},
			scope: createRuntimeStudioScope("aaaa"),
		});
		models.sync([file("f1", MAIN, "x")]);
		const model = models.get("f1")?.model;
		expect(model).toBeDefined();
		expect(pathsFor(model as RuntimeEditorModel)).toEqual([]);

		catalog.current = prepareRuntimeAssetCatalog([asset("ui/heart")], MEDIA);
		models.sync([file("f1", MAIN, "x")]);

		expect(models.get("f1")?.model).toBe(model);
		expect(pathsFor(model as RuntimeEditorModel)).toEqual(["ui/heart"]);
	});

	/**
	 * Each mount gets a new scope. Neither StrictMode's double mount nor a stale model left by HMR can
	 * claim the new editor's address.
	 */
	it("a new mount does not inherit the old mount's URIs", () => {
		expect(createRuntimeStudioScope()).not.toBe(createRuntimeStudioScope());
	});

	it("a new mount does not reuse models the old mount left behind", () => {
		const registry = new FakeRegistry();
		const first = mount(registry, "aaaa", [], [file("f1", MAIN, "old")]);
		const stale = first.model("f1");
		/** The next editor mounts before cleanup has run (HMR or a forced unmount). */
		const second = mount(registry, "bbbb", [], [file("f1", MAIN, "fresh")]);

		expect(second.model("f1") === stale).toBe(false);
		expect(second.model("f1").getValue()).toBe("fresh");
		expect(stale.getValue()).toBe("old");
	});
});

/**
 * The isolation tests above cover two editors alive at the same time. The more common case is
 * sequential: closing draft A and opening B, or signing out and opening the same draft shape as
 * another member. In that case the same logical name is expected to point at different media (two
 * people each bind characters/sena/smile). If the name resolved to the earlier person's media,
 * someone else's picture would appear in this editor's hover, and no error would be raised.
 */
describe("draft and account switch: same names, different media", () => {
	const named = (mediaId: string): RuntimeAssetEditorEntry => ({
		...asset("characters/sena/smile"),
		mediaId,
	});
	const SOURCE = 'asset("characters/sena/smile")';
	const cursor = SOURCE.indexOf("smile");
	const hoverUrl = (model: RuntimeEditorModel) => {
		const catalog = runtimeAssetCatalogFor(model);
		return catalog === null
			? null
			: (planRuntimeAssetHover(catalog, SOURCE, cursor)?.image?.url ?? null);
	};

	it("an editor opened after closing resolves only its own media", () => {
		const registry = new FakeRegistry();
		const alice = mount(
			registry,
			"aaaa",
			[named("alice-media")],
			[file("f1", MAIN, SOURCE)],
		);
		const aliceModel = alice.model("f1");
		expect(hoverUrl(aliceModel)).toContain("alice-media");

		alice.models.dispose();
		const bob = mount(
			registry,
			"bbbb",
			[named("bob-media")],
			[file("f1", MAIN, SOURCE)],
		);

		expect(hoverUrl(bob.model("f1"))).toContain("bob-media");
		expect(hoverUrl(bob.model("f1"))).not.toContain("alice-media");
		/** A closed editor's model resolves nothing. The result is null, not an empty list. */
		expect(runtimeAssetCatalogFor(aliceModel)).toBeNull();
	});

	/** Even if cleanup did not run (HMR or forced unmount), the next editor's lists do not mix. */
	it("leftover old models still can't see each other", () => {
		const registry = new FakeRegistry();
		const alice = mount(
			registry,
			"aaaa",
			[named("alice-media")],
			[file("f1", MAIN, SOURCE)],
		);
		const bob = mount(
			registry,
			"bbbb",
			[named("bob-media")],
			[file("f1", MAIN, SOURCE)],
		);
		expect(hoverUrl(alice.model("f1"))).toContain("alice-media");
		expect(hoverUrl(bob.model("f1"))).toContain("bob-media");
		expect(pathsFor(bob.model("f1"))).toEqual(["characters/sena/smile"]);
	});

	/**
	 * If the editor moved to has nothing bound yet, the previous person's names must not be suggested.
	 */
	it("moving to an empty draft leaves no suggestions", () => {
		const registry = new FakeRegistry();
		const alice = mount(
			registry,
			"aaaa",
			[named("alice-media")],
			[file("f1", MAIN, SOURCE)],
		);
		alice.models.dispose();
		const empty = mount(registry, "cccc", [], [file("f1", MAIN, SOURCE)]);
		expect(pathsFor(empty.model("f1"))).toEqual([]);
		expect(hoverUrl(empty.model("f1"))).toBeNull();
	});
});

/**
 * Candidate paths searched by walking up parent directories for node_modules, the same way
 * TypeScript's module resolution does.
 */
function nodeModulesCandidates(fileUri: string, request: string): string[] {
	const candidates: string[] = [];
	let directory = fileUri.slice(0, fileUri.lastIndexOf("/"));
	while (directory.includes("/") && !directory.endsWith("//")) {
		candidates.push(`${directory}/node_modules/${request}`);
		const next = directory.slice(0, directory.lastIndexOf("/"));
		if (next === directory) break;
		directory = next;
	}
	return candidates;
}

describe("URI shape", () => {
	const scope = createRuntimeStudioScope("aaaa");

	it("the scope is one segment under the root", () => {
		expect(runtimeStudioModelUri(scope, MAIN)).toBe(
			`file://${RUNTIME_VIRTUAL_ROOT}/__studio__/${scope}/${MAIN}`,
		);
	});

	/**
	 * Warning: if the path leaves the root, `@rowcat/runtime` cannot be found, and the symptom is a
	 * red line on the first line of every file. The declarations are a global extraLib with a single
	 * source, so only the location of the project may vary.
	 */
	it("reaches the runtime package's declarations by walking up", () => {
		const manifest = runtimePackageFiles(RUNTIME_VIRTUAL_ROOT)[0]?.path ?? "";
		expect(manifest).toBe(
			`${RUNTIME_VIRTUAL_ROOT}/node_modules/@rowcat/runtime/package.json`,
		);
		expect(
			nodeModulesCandidates(
				runtimeStudioModelUri(scope, MAIN),
				"@rowcat/runtime",
			),
		).toContain(`file://${RUNTIME_VIRTUAL_ROOT}/node_modules/@rowcat/runtime`);
	});

	it("relative imports in the same editor resolve in the same folder", () => {
		const main = runtimeStudioModelUri(scope, MAIN);
		const state = runtimeStudioModelUri(scope, "src/state.ts");
		expect(state).toBe(`${main.slice(0, main.lastIndexOf("/"))}/state.ts`);
	});

	/**
	 * Another editor's sibling files live in a different folder, so `./state` never resolves to
	 * someone else's file.
	 */
	it("another editor's sibling files are in a different folder", () => {
		const other = createRuntimeStudioScope("bbbb");
		const here = runtimeStudioModelUri(scope, "src/state.ts");
		const there = runtimeStudioModelUri(other, "src/state.ts");
		expect(here.slice(0, here.lastIndexOf("/"))).not.toBe(
			there.slice(0, there.lastIndexOf("/")),
		);
	});

	/**
	 * Even if an author creates a folder named `__studio__`, the scope segment comes first, so the two
	 * cannot collide.
	 */
	it("a creator's path can't take the scope segment", () => {
		expect(runtimeStudioModelUri(scope, "__studio__/x.ts")).toBe(
			`file://${RUNTIME_VIRTUAL_ROOT}/__studio__/${scope}/__studio__/x.ts`,
		);
	});
});

describe("registry", () => {
	it("creates a model only when the URI is free", () => {
		const registry = new FakeRegistry();
		const create = vi.spyOn(registry, "createModel");
		mount(registry, "aaaa", [], [file("f1", MAIN, "x")]);
		expect(create).toHaveBeenCalledTimes(1);
		expect(create.mock.calls[0]?.[1]).toContain("__studio__");
	});
});
