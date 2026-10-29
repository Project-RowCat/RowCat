import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RUNTIME_PANEL_LABEL, RUNTIME_PANEL_TABS } from "./layout/panels.ts";
import {
	RUNTIME_ASSETS,
	RUNTIME_INTRO,
	RUNTIME_SECTION,
	runtimeAssetRemoveConfirm,
	runtimeAssetRenameDescription,
} from "./runtime-copy.ts";

/**
 * A static check of what the runtime studio must not do. The folder's promise: it is an authoring
 * surface and never runs author code in this realm. Execution belongs to the QuickJS/WASM host
 * inside the features/runtime-preview worker. This folder receives only one hook handle from it.
 * The breach is easy to make. 'Since there is a preview, run it here once' sounds reasonable, and
 * the shortest implementation is an iframe with srcdoc or new Function. Such code type-checks and
 * renders, and the failure is silent: foreign code runs with this origin's privileges (session
 * cookie, IndexedDB and sync keys are all there). Isolation must not apply to only one of the two
 * execution paths. This test checks policy, not rendered output, since the web test suite has no
 * React rendering. Whether the folder imports the forbidden construct is answerable from source
 * alone.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));

/**
 * Source with comments stripped. The folder header describes what it does not do by name (for
 * example, 'no eval, no new Function'). If that prose were scanned, the explanation would be
 * reported as a violation, and the next person would 'fix' it by deleting the explanation. Only
 * executable code is scanned.
 */
function stripComments(source: string): string {
	return source
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function* sources(root: string): Generator<string> {
	for (const name of readdirSync(root)) {
		const path = join(root, name);
		if (statSync(path).isDirectory()) {
			yield* sources(path);
			continue;
		}
		if (!/\.tsx?$/.test(name) || name.includes(".test.")) continue;
		yield path;
	}
}

const files = () =>
	[...sources(HERE)].map((path) => ({
		name: path.slice(HERE.length),
		source: stripComments(readFileSync(path, "utf8")),
	}));

/**
 * Patterns that mark a boundary crossing if they appear in this folder. Each entry carries its own
 * reason.
 */
const FORBIDDEN: { door: RegExp; why: string }[] = [
	{
		door: /\beval\s*\(/,
		why: "the shortest way to run creator code on this origin; session cookies, IndexedDB and the sync key are all right there.",
	},
	{
		door: /new\s+Function\s*\(/,
		why: "the same thing as `eval`, used more often because the name sounds less scary.",
	},
	{
		door: /<iframe/i,
		why: "it's easy to believe `srcdoc` and `sandbox` isolate it, but that isolation is a boundary we have never reviewed; execution isolation is the WASM VM's job.",
	},
	{
		door: /createObjectURL/,
		why: "a Blob URL turns a script into an executable address; this folder has no reason to do that.",
	},
	{
		door: /new\s+Worker\s*\(/,
		why: "workers are our origin too; Monaco's workers come from a `?worker` import (one setup file), and the only reason feature code would make one is to run creator code.",
	},
	{
		door: /\bimportScripts\s*\(/,
		why: "a way to load arbitrary scripts inside a worker.",
	},
	{
		door: /dangerouslySetInnerHTML/,
		why: "the place that would run what a creator wrote as markup; everything this folder draws is text.",
	},
	{
		door: /\.innerHTML\s*=/,
		why: "same as above, just a shorter detour.",
	},
];

describe("no execution", () => {
	it.each(FORBIDDEN)("$door is not in this folder", ({ door, why }) => {
		const offenders = files()
			.filter((file) => door.test(file.source))
			.map((file) => file.name);
		expect(offenders, why).toEqual([]);
	});

	/**
	 * Worker wiring is allowed in one config file only. The ?worker import cannot be banned outright,
	 * because Monaco requires it. Instead, the one file allowed to contain it is pinned: if another
	 * file starts creating workers, it is trying to run something, not wiring Monaco.
	 */
	it("worker imports exist only in monaco-setup", () => {
		const offenders = files()
			.filter((file) => file.source.includes("?worker"))
			.map((file) => file.name);
		expect(offenders).toEqual(["editor/monaco-setup.ts"]);
	});

	/**
	 * Monaco may be imported as a value in two places. The second is a worker entry point, which runs
	 * on another thread. Going through the setup module sets up the worker, languages, grammar and
	 * ambient types once. A direct import elsewhere produces an editor without the type service: it
	 * draws text but no types, and raises no error. The worker entry cannot satisfy the rule. A worker
	 * is a separate thread evaluated as its own module, so its file cannot live inside the setup
	 * module. Monaco 0.56's worker contract has no semantic classification, so a derived class was
	 * needed and the list has two entries. The list changed shape rather than loosened, and the two
	 * lines below narrow it again. The editor component references types only with typeof import(...),
	 * which emits no runtime import, so it correctly stays off the list.
	 */
	it("only the setup and worker entry import monaco as a value", () => {
		const offenders = files()
			.filter((file) =>
				/^import\s+(?!type\b)[^;]*from\s+"monaco-editor/m.test(file.source),
			)
			.map((file) => file.name)
			.sort();
		expect(offenders).toEqual([
			"editor/monaco-setup.ts",
			"editor/monaco-ts.worker.ts",
		]);
	});

	/**
	 * The worker entry point must not touch the editor. That thread has no DOM or editor. Naming them
	 * would compile, but the code throws inside the worker. Errors there never reach the screen, so
	 * the failure looks like 'sometimes no semantic colors'.
	 */
	it("the worker entry has no editor or DOM", () => {
		const worker = files().find(
			(file) => file.name === "editor/monaco-ts.worker.ts",
		);
		expect(worker).toBeDefined();
		for (const door of ["monaco.editor", "defineTheme", "document.", "window."])
			expect(worker?.source, door).not.toContain(door);
	});

	/**
	 * The worker adds one read. Widening Monaco's worker contract in our copy would drift across
	 * version upgrades, and the drift would show only inside the worker. The one addition is a
	 * function that supplies semantic classification.
	 */
	it("the worker does not widen Monaco's contract", () => {
		const worker = files().find(
			(file) => file.name === "editor/monaco-ts.worker.ts",
		);
		const added = [
			...(worker?.source.matchAll(/^\tasync\s+(\w+)\s*\(/gm) ?? []),
		].map((match) => match[1]);
		expect(added).toEqual(["getEncodedSemanticClassifications"]);
	});
});

/**
 * Syntax highlighting has a single source. The regression this guards against: a theme is defined
 * with its rules once, then later defineTheme({ colors, rules: [] }) is called just to change the
 * background. All token colors vanish with no error, and the change looks like an ordinary diff.
 * Three things are locked: one place defines themes, that place always goes through the same
 * builder, and no empty rules array appears in this folder.
 */
describe("the theme has one source", () => {
	it("monaco-setup is the one place that defines themes", () => {
		const offenders = files()
			.filter((file) => /\bdefineTheme\s*\(/.test(file.source))
			.map((file) => file.name);
		expect(offenders).toEqual(["editor/monaco-setup.ts"]);
	});

	it("every definition goes through the builder", () => {
		const setup = files().find(
			(file) => file.name === "editor/monaco-setup.ts",
		);
		const defines = (setup?.source.match(/\bdefineTheme\s*\(/g) ?? []).length;
		const built = (setup?.source.match(/runtimeMonacoTheme\s*\(/g) ?? [])
			.length;
		expect(defines).toBeGreaterThan(0);
		expect(
			built,
			"a theme of colors alone must not be expressible; the builder emits the rules too",
		).toBe(defines);
	});

	it("there is no empty rules array in this folder", () => {
		const offenders = files()
			.filter((file) => /rules:\s*\[\s*\]/.test(file.source))
			.map((file) => file.name);
		expect(offenders).toEqual([]);
	});

	/**
	 * The grammar comes from Monaco's official definition, so the keyword list is not copied. TSX adds
	 * a few state values on top, but the vocabulary (keywords, operators, symbols, escapes) comes from
	 * the official object. A copy would drift when TypeScript adds a keyword, and the drift would show
	 * only to authors who used that keyword.
	 */
	it("one place builds the grammar, and it comes from the official definition", () => {
		const offenders = files()
			.filter((file) => /setMonarchTokensProvider\s*\(/.test(file.source))
			.map((file) => file.name);
		expect(offenders).toEqual(["editor/monaco-setup.ts"]);

		const setup = files().find(
			(file) => file.name === "editor/monaco-setup.ts",
		);
		expect(setup?.source).toContain(
			'from "monaco-editor/languages/definitions/typescript/typescript"',
		);

		const grammar = files().find(
			(file) => file.name === "editor/tsx-grammar.ts",
		);
		for (const keyword of ["instanceof", "readonly", "satisfies"])
			expect(
				grammar?.source,
				`${keyword}: the vocabulary is the official definition's`,
			).not.toContain(`"${keyword}"`);
	});
});

/**
 * The introductory copy must be honest. Any wording that reads as 'coming soon' is an undated
 * promise, and the author waits for it.
 */
describe("copy", () => {
	it("makes no promise it can't keep", () => {
		const copy = [
			RUNTIME_INTRO.title,
			RUNTIME_INTRO.body,
			RUNTIME_INTRO.action,
			...RUNTIME_INTRO.capabilities,
			RUNTIME_SECTION.title,
			RUNTIME_SECTION.description,
		].join("\n");

		/**
		 * Forbidden words: `soon`, `coming soon`, `planned` (undated promises that readers wait on), and `beta`
		 * and `experimental` (read as the feature being on, when only the editor is on, not execution).
		 */
		for (const promise of [
			/soon/i,
			/release/i,
			/planned/i,
			/beta/i,
			/experimental/i,
			/when ready/i,
		])
			expect(copy).not.toMatch(promise);
	});

	it("states that turning it on doesn't replace the existing authoring surface", () => {
		expect(RUNTIME_INTRO.body).toContain("stay as they are");
		expect(RUNTIME_SECTION.description).toContain("optional");
	});
});

/**
 * There is no second source for the runtime API. Phase 1 had a hand-written .d.ts string here, and
 * its declarations were wrong: JSX.Element resolved to unknown, so `<Screen><Text/></Screen>` was
 * not assignable to children: RuntimeNode, and the starter project opened with red error lines.
 * With two sources, such drift recurs silently, and neither breaks compilation. The editor now
 * loads the exact files the compiler places into its virtual file system.
 */
describe("the runtime API has one source", () => {
	it("there is no hand-written declaration file in this folder", () => {
		const offenders = files()
			.filter((file) =>
				/declare\s+module\s+"@rowcat\/runtime/.test(file.source),
			)
			.map((file) => file.name);
		expect(
			offenders,
			"declarations come from @rowcat/runtime's source; writing them again here would split into two sources",
		).toEqual([]);
	});

	it("does not imitate the component contract in a string", () => {
		const offenders = files()
			.filter((file) =>
				/declare\s+namespace\s+JSX|export\s+function\s+(Screen|Stack|Text)\s*\(/.test(
					file.source,
				),
			)
			.map((file) => file.name);
		expect(offenders).toEqual([]);
	});

	/**
	 * Editor settings come from the compiler. Copying them by hand creates a second source at once.
	 * When it drifts, the symptom is autocompletion allowing code that the compile then rejects.
	 */
	it("does not hand-write compiler options", () => {
		const setup = files().find(
			(file) => file.name === "editor/monaco-setup.ts",
		);
		expect(setup?.source).toContain("runtimeCompilerOptions()");
		expect(setup?.source).toContain("runtimePackageFiles(");
		/** Setting jsxImportSource here would diverge from the compiler's value. */
		expect(setup?.source).not.toContain("jsxImportSource:");
	});
});

/**
 * Including the compiler is not including execution. This folder imports a package that can emit
 * code. The forbidden list above and the two lines below block the request to 'run it here since it
 * compiles'. The execution host is set up only in the features/runtime-preview worker, and that
 * folder's boundary check enforces it.
 */
describe("compiling is not executing", () => {
	/**
	 * Import only as types, never as values. `import type` emits nothing, so it cannot pull the
	 * engine, session or generated sandbox into the bundle. Blocking this too would force the State
	 * tab to hand-copy the snapshot shape, and that copy would silently go stale when the contract
	 * changes.
	 */
	it("this folder does not import the execution host as a value", () => {
		const offenders = files()
			.filter((file) =>
				/^import\s+(?!type\b)[^;]*from\s+"@rowcat\/runtime-host/m.test(
					file.source,
				),
			)
			.map((file) => file.name);
		expect(
			offenders,
			"preview execution belongs to the features/runtime-preview worker; this folder sees only its hook",
		).toEqual([]);
	});

	it("there is no artifact-building path in this folder", () => {
		const offenders = files()
			.filter((file) => /compileRuntimeProject\s*\(/.test(file.source))
			.map((file) => file.name);
		expect(
			offenders,
			"the studio uses only the analysis pass; full compilation belongs to the preview worker",
		).toEqual([]);
	});

	/**
	 * Renderer construction also lives outside this folder. The screen only passes an element to it.
	 */
	it("does not start a renderer", () => {
		const offenders = files()
			.filter((file) => /createWebRuntimeRenderer/.test(file.source))
			.map((file) => file.name);
		expect(offenders).toEqual([]);
	});
});

/**
 * Empty tabs are not held as placeholders. Console came back together with the code that draws its
 * values (the preview worker's console output and runtime diagnostics). State was still absent at
 * that point, since hook state lives in the VM and no channel exposes it yet. Adding names first
 * would turn the panel into a 'coming soon' placeholder.
 */
describe("bottom panel", () => {
	/**
	 * State returned for the same reason Console did: there is now a real value to draw. The panel
	 * draws the preview's saved snapshot (the playthrough state it holds). If no state is declared,
	 * the panel says why it is empty. In Phase 1 both tabs drew a single 'available once the engine
	 * exists' line and were removed for that reason.
	 */
	it("every pane has something to draw", () => {
		expect([...RUNTIME_PANEL_TABS]).toEqual([
			"problems",
			"console",
			"state",
			"runtime",
		]);
	});

	it("every pane has a label, so none draws blank", () => {
		for (const tab of RUNTIME_PANEL_TABS)
			expect(RUNTIME_PANEL_LABEL[tab]?.length ?? 0).toBeGreaterThan(0);
	});

	/**
	 * useState is not drawn here. Its value belongs to the VM session: it is neither saved nor carried
	 * across sessions. Placing it beside saved state would make two lifetimes look like one.
	 */
	it("makes no way to peek into hook state", () => {
		const panel = files().find(
			(file) => file.name === "layout/bottom-panel.tsx",
		);
		expect(panel?.source).not.toMatch(/\bhookState\b|\bcomponentState\b/);
	});
});

/**
 * What image intelligence (autocomplete and hover) must not do. The slice added only editor
 * conveniences, but those could quietly cross three boundaries: the lifetime of the global
 * provider; a list display that becomes a request; and renaming that edits the author's source.
 */
describe("image intelligence", () => {
	const INTELLIGENCE = [
		"assets/catalog.ts",
		"assets/completions.ts",
		"assets/hover.ts",
		"assets/source.ts",
	];

	/**
	 * registerCompletionItemProvider is a global registration per language. Calling it on every editor
	 * mount would repeat each item, and the duplicates would grow each time the studio is opened and
	 * closed. Registration therefore belongs in one idempotent setup function.
	 */
	it("provider registration exists only in monaco-setup", () => {
		const offenders = files()
			.filter((file) =>
				/monaco\.languages\.register\w*Provider\s*\(/.test(file.source),
			)
			.map((file) => file.name);
		expect(offenders).toEqual(["editor/monaco-setup.ts"]);
	});

	it("registration sits inside the idempotent gate", () => {
		const setup = files().find(
			(file) => file.name === "editor/monaco-setup.ts",
		);
		const guard = setup?.source.indexOf("if (configured) return monaco;") ?? -1;
		const register =
			setup?.source.indexOf("registerCompletionItemProvider") ?? -1;
		expect(guard).toBeGreaterThanOrEqual(0);
		expect(
			register,
			"registering before the `configured` gate would add entries every time an editor opens",
		).toBeGreaterThan(guard);
	});

	/**
	 * The global provider tells drafts apart by model object identity. If the list were captured in a
	 * closure at registration time, a user who opened draft A and then switched to B would see A's
	 * names, with no error. So providers take no list argument and look the list up in a table.
	 */
	it("providers don't capture the list in a closure", () => {
		const providers = files().filter((file) =>
			["assets/completions.ts", "assets/hover.ts"].includes(file.name),
		);
		expect(providers).toHaveLength(2);
		for (const provider of providers) {
			expect(provider.source, provider.name).toContain(
				"runtimeAssetCatalogFor(model)",
			);
			expect(
				/createRuntimeAsset\w+Provider\([^)]*(?:assets|catalog|entries)/.test(
					provider.source,
				),
				`${provider.name}: the model answers the list, not the registration`,
			).toBe(false);
		}
	});

	/**
	 * Keying by path would make two drafts share an entry, because src/main.tsx exists in every draft.
	 */
	it("the list is keyed by the model object", () => {
		const catalog = files().find((file) => file.name === "assets/catalog.ts");
		expect(catalog?.source).toContain("new WeakMap<object,");
	});

	/**
	 * Warning: if listing images were a request, every `asset("` trigger would cost a round trip per
	 * project image. The data is already on the device as authoring records. Bytes are fetched only
	 * when a hovered picture actually renders as an <img>.
	 */
	it("the intelligence layer makes no network requests", () => {
		const offenders = files()
			.filter((file) => INTELLIGENCE.includes(file.name))
			.filter((file) =>
				/\bfetch\s*\(|XMLHttpRequest|new\s+Image\s*\(|getRowCatClient/.test(
					file.source,
				),
			)
			.map((file) => file.name);
		expect(offenders).toEqual([]);
	});

	/**
	 * Storage and sync vocabulary stays out of this layer as well. The list arrives already narrowed
	 * to the relevant entries.
	 */
	it("the intelligence layer doesn't know the authoring store", () => {
		const offenders = files()
			.filter((file) => INTELLIGENCE.includes(file.name))
			.filter((file) =>
				/AuthoringStore|useAuthoringScope|\bdexie\b|liveQuery/i.test(
					file.source,
				),
			)
			.map((file) => file.name);
		expect(offenders).toEqual([]);
	});

	/**
	 * Renaming must not become a source edit. Some uses go through aliases or constants, assembled
	 * names cannot be enumerated, and editing several files in one transaction would need undo
	 * semantics defined. Getting any one of these wrong silently changes the author's text.
	 */
	it("renaming does not edit source", () => {
		const panel = files().find((file) => file.name === "assets/panel.tsx");
		/**
		 * Finding references uses the same scanner as autocomplete and hover. A second regex here would
		 * either count examples inside comments or miss the contents of template literals.
		 */
		expect(panel?.source).toContain("findRuntimeAssetReferences");
		expect(panel?.source).not.toMatch(/\/[^/\n]*asset\\\(/);
		for (const write of [
			"patchRuntimeFile",
			"updateRuntimeFile",
			"createRuntimeFile",
			"onChange(",
		])
			expect(
				panel?.source,
				`${write}: this screen only reads source`,
			).not.toContain(write);
	});

	/**
	 * This is the one place that decides which pipeline a chosen file belongs to. Upload, authoring
	 * records and replacement patches must not ask again. Asking again creates four judgments, and if
	 * one drifts, an MP3 gets routed to the image route.
	 */
	it("the kind is decided once, at the moment of choosing", () => {
		const panel = files().find((file) => file.name === "assets/panel.tsx");
		expect(panel?.source).toContain("looksLikeRuntimeAudio(");
		expect(panel?.source).toContain("uploadAudio(");
		expect(panel?.source).toContain("uploadImage(");
		/**
		 * The audio check runs before the image check. If reversed, an empty `.m4a` with an empty MIME
		 * type would be rejected as an unsupported image format.
		 */
		expect(panel?.source.indexOf("checkRuntimeAudioFile(")).toBeLessThan(
			panel?.source.indexOf("checkRuntimeImageFile(") ?? -1,
		);
	});

	/**
	 * Replacement fixes the kind. If an image name silently became a sound, the project would learn of
	 * it only on the next playback. Changing kind is a remove plus an add, and those two steps are the
	 * confirmation that this is a different asset.
	 */
	it("replacing requires the target's kind as is", () => {
		const panel = files().find((file) => file.name === "assets/panel.tsx");
		expect(panel?.source).toMatch(/accept\(event, target\?\.kind\)/);
		expect(panel?.source).toMatch(/kind: asset\.kind/);
		const copy = files().find((file) => file.name === "runtime-copy.ts");
		expect(copy?.source).toContain("replaceKindImage");
		expect(copy?.source).toContain("replaceKindAudio");
	});
});

/**
 * Ownership of editor models. The quietest defect in this folder was here. Monaco's model registry
 * is global. While the address was built from the project path alone (file://<root>/src/main.tsx),
 * two studio instances could share the same ITextModel. Then not only autocomplete mixed: the
 * displayed text, the onChange draft and the model discarded on unmount all mixed, with no error.
 */
describe("model ownership", () => {
	/**
	 * Warning: the shortest way to bring back an unscoped address is to write file://<root>/... again
	 * somewhere in this folder. That line looks like its neighbors and goes unnoticed in review, so
	 * address creation is pinned to one place. The type also blocks it: RuntimeStudioScope is a
	 * branded string, so a plain string cannot be passed.
	 */
	it("one place builds model URIs", () => {
		const offenders = files()
			.filter((file) => /file:\/\/\$\{?RUNTIME_VIRTUAL_ROOT/.test(file.source))
			.map((file) => file.name);
		expect(
			offenders,
			"without a scope in the URI, two editors share one model",
		).toEqual(["editor/models.ts"]);
	});

	it("the scope segment's name also ends inside that file", () => {
		const offenders = files()
			.filter((file) => file.source.includes("__studio__"))
			.map((file) => file.name);
		expect(offenders).toEqual(["editor/models.ts"]);
	});

	/**
	 * The scope is an implementation detail of Monaco. The path the author sees, the path that goes
	 * into published output, and the path the preview receives are always the record's path
	 * (src/main.tsx). The failure mode would be a snapshot starting to read the model's address.
	 */
	it("the source snapshot doesn't know model URIs", () => {
		const offenders = files()
			.filter((file) =>
				["compile/source-snapshot.ts", "use-runtime-sources.ts"].includes(
					file.name,
				),
			)
			.filter((file) =>
				/runtimeStudioModelUri|RuntimeStudioScope|__studio__|\.uri\b/.test(
					file.source,
				),
			)
			.map((file) => file.name);
		expect(
			offenders,
			"publishing and preview receive only { path, content }",
		).toEqual([]);
	});

	/**
	 * The scope is not derived from the draft id. The same draft mounted twice (test double-mount,
	 * StrictMode, or a future split view) would otherwise get the same address again.
	 */
	it("the scope is not derived from the draft id", () => {
		const models = files().find((file) => file.name === "editor/models.ts");
		expect(models?.source).not.toMatch(/\bdraftId\b|\bstoryId\b/);
	});

	/**
	 * Provider registration stays a single global. If changing model identity spread to 'each editor
	 * registers its own provider', duplicate items, stale closures and provider leaks would all return
	 * together.
	 */
	it("the model layer registers no providers", () => {
		const models = files().find((file) => file.name === "editor/models.ts");
		expect(models?.source).not.toMatch(/register\w*Provider/);
	});
});

/** Copy that reports usages. It never claims to have counted what cannot be counted. */
describe("usage copy", () => {
	it("no count without usages", () => {
		expect(runtimeAssetRenameDescription(0)).toBe(RUNTIME_ASSETS.renameNotice);
		expect(runtimeAssetRemoveConfirm("ui/heart", 0).references).toBeNull();
	});

	it("rename states the count first, then that the code is unchanged", () => {
		const copy = runtimeAssetRenameDescription(3);
		expect(copy).toContain("3 places");
		expect(copy.indexOf("3 places")).toBeLessThan(
			copy.indexOf("automatically"),
		);
		expect(copy).toContain("doesn't change the code automatically");
	});

	it("remove states that those places become placeholders", () => {
		const copy = runtimeAssetRemoveConfirm("ui/heart", 2);
		expect(copy.references).toContain("2 places");
		expect(copy.references).toContain("placeholder");
		/**
		 * The existing order is unchanged: what remains is described first. The file bytes are not
		 * deleted.
		 */
		expect(copy.description).toContain("isn't deleted");
	});

	/**
	 * Warning: assembled names cannot be counted. Someone who deleted an image trusting 'used in
	 * exactly 3 places' could not find the cause when the picture vanished from the screen.
	 */
	it("does not claim to be exhaustive", () => {
		const copy = [
			runtimeAssetRenameDescription(3),
			runtimeAssetRemoveConfirm("ui/heart", 3).references ?? "",
		].join("\n");
		expect(copy).toContain("written directly");
		for (const claim of ["exactly", "all uses", "every"])
			expect(copy).not.toContain(claim);
	});
});
