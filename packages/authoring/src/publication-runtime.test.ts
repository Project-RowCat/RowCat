import { describe, expect, it } from "vitest";
import { createStoryDraftRecord, markAuthoringDeleted } from "./model.ts";
import { prepareStoryPublication } from "./publication.ts";
import {
	createDraftRuntimeAssetRecord,
	createDraftRuntimeFileRecord,
	createDraftRuntimeProjectRecord,
	type DraftRuntimeAsset,
} from "./runtime.ts";
import {
	PUBLICATION_ISSUE_CODE,
	validateStoryPublication,
} from "./validation.ts";

/**
 * Pins the runtime axis of a publish request as three distinct meanings:
 * - Field absent: the caller does not know the runtime. On update, the server keeps what is
 *   published.
 * - `mode: "disabled"`: turned off. The published runtime is removed.
 * - `mode: "source"`: one source bundle. The point of this file is that the first and second stay
 *   separate. Folding them together would let an update from an older client, sent during a
 *   rollout, silently delete a published runtime.
 */

const NOW = "2026-01-01T00:00:00.000Z";
const REV = { t: 1_767_225_600_000, c: 0, d: "test-device" };
const stamp = (id: string) => ({ id, now: NOW, rev: REV });

const draft = createStoryDraftRecord(
	{ title: "The Night Library", prompt: "A library where books talk." },
	stamp("draft-1"),
);

const project = (enabled: boolean, entry = "src/main.tsx") => ({
	...createDraftRuntimeProjectRecord(
		{ draftId: "draft-1", enabled, entry },
		{
			now: NOW,
			rev: REV,
		},
	),
});

const file = (id: string, path: string, content = "export default 1;") =>
	createDraftRuntimeFileRecord(
		{ draftId: "draft-1", path, content },
		stamp(id),
	);

const asset = (
	id: string,
	path: string,
	assetId = `media-${id}`,
): DraftRuntimeAsset =>
	createDraftRuntimeAssetRecord(
		{
			draftId: "draft-1",
			path,
			kind: "image",
			assetId,
			mime: "image/webp",
			width: 4,
			height: 4,
		},
		stamp(id),
	);

const audioAsset = (
	id: string,
	path: string,
	assetId = `media-${id}`,
): DraftRuntimeAsset =>
	createDraftRuntimeAssetRecord(
		{
			draftId: "draft-1",
			path,
			kind: "audio",
			assetId,
			mime: "audio/mpeg",
			durationMs: 12_000,
		},
		stamp(id),
	);

type RuntimeSource = NonNullable<
	Parameters<typeof prepareStoryPublication>[0]["runtime"]
>;

/**
 * Making `assets` optional here is a convenience of this test helper, not part of the contract. The
 * real source type requires it, so a caller that knows the runtime cannot omit the asset list
 * without a compile error.
 */
const prepare = (
	runtime?: Omit<RuntimeSource, "assets"> & { assets?: DraftRuntimeAsset[] },
) =>
	prepareStoryPublication({
		draft,
		lore: [],
		startScenes: [],
		sceneImages: [],
		...(runtime === undefined
			? {}
			: { runtime: { ...runtime, assets: runtime.assets ?? [] } }),
	});

describe("three branches", () => {
	it("no field rides when the caller does not know about runtime", () => {
		/**
		 * `undefined` means silence: on update, the server keeps the currently published runtime as it
		 * is.
		 */
		expect(prepare().publication.runtime).toBeUndefined();
	});

	it("without a project it is explicitly disabled", () => {
		const prepared = prepare({ project: null, files: [], apiVersion: 3 });
		expect(prepared.publication.runtime).toEqual({ mode: "disabled" });
	});

	it("a project that is off is explicitly disabled too, even with files left", () => {
		const prepared = prepare({
			project: project(false),
			files: [file("f1", "src/main.tsx")],
			apiVersion: 3,
		});
		expect(prepared.publication.runtime).toEqual({ mode: "disabled" });
	});

	it("when on, the source rides", () => {
		const prepared = prepare({
			project: project(true),
			files: [file("f1", "src/main.tsx", "export default 1;")],
			apiVersion: 3,
		});
		expect(prepared.publication.runtime).toEqual({
			mode: "source",
			project: {
				apiVersion: 3,
				entry: "src/main.tsx",
				files: [{ path: "src/main.tsx", content: "export default 1;" }],
				/**
				 * A project with no bound assets still sends an empty array. That is a different meaning from
				 * absent.
				 */
				assets: [],
			},
		});
	});
});

describe("normalization", () => {
	it("files are in ascending path order: the bytes must be the same on every device", () => {
		const prepared = prepare({
			project: project(true),
			files: [
				file("f2", "src/z.ts"),
				file("f1", "src/main.tsx"),
				file("f3", "src/a.ts"),
			],
			apiVersion: 3,
		});
		const runtime = prepared.publication.runtime;
		expect(runtime?.mode).toBe("source");
		if (runtime?.mode !== "source") return;
		expect(runtime.project.files.map((entry) => entry.path)).toEqual([
			"src/a.ts",
			"src/main.tsx",
			"src/z.ts",
		]);
	});

	it("deleted files do not reach the publication", () => {
		/**
		 * Passing soft-deleted records through would bring deleted files back into the published build.
		 * If one of them intercepted the entry point, code the author deleted would run for players.
		 */
		const removed = markAuthoringDeleted(file("f2", "src/gone.ts"), NOW, REV);
		const prepared = prepare({
			project: project(true),
			files: [file("f1", "src/main.tsx"), removed],
			apiVersion: 3,
		});
		const runtime = prepared.publication.runtime;
		if (runtime?.mode !== "source") throw new Error("not the source branch");
		expect(runtime.project.files.map((entry) => entry.path)).toEqual([
			"src/main.tsx",
		]);
	});
});

describe("entry file", () => {
	it("blocks publishing when missing", () => {
		/**
		 * No remaining file is used as a fallback entry point. Otherwise a program the author never chose
		 * would be published.
		 */
		const prepared = prepare({
			project: project(true, "src/missing.tsx"),
			files: [file("f1", "src/main.tsx")],
			apiVersion: 3,
		});
		expect(prepared.runtimeIssues.entryMissing).toBe(true);

		const issues = validateStoryPublication(prepared.publication, {
			defaultStartSceneResolved: true,
			runtimeIssues: prepared.runtimeIssues,
		});
		expect(issues.map((issue) => issue.code)).toContain(
			PUBLICATION_ISSUE_CODE.runtimeEntryMissing,
		);
	});

	it("that decision does not stand for a project that is off", () => {
		const prepared = prepare({
			project: project(false, "src/missing.tsx"),
			files: [],
			apiVersion: 3,
		});
		expect(prepared.runtimeIssues.entryMissing).toBe(false);
	});
});

/**
 * The prompt requirement follows the execution model. An empty prompt passes only for publishes
 * that carry a runtime source. Publishes without the field (callers unaware of the runtime) and
 * explicit `disabled` still require a prompt. Loosening the first would let an older client's
 * update pass with an empty prompt. The second is a conversation story, which needs one.
 */
describe("when the prompt is required", () => {
	const emptyPromptDraft = createStoryDraftRecord(
		{ title: "A story with only a title", prompt: "" },
		stamp("draft-2"),
	);
	const prepareEmpty = (
		runtime?: Omit<RuntimeSource, "assets"> & { assets?: DraftRuntimeAsset[] },
	) =>
		prepareStoryPublication({
			draft: emptyPromptDraft,
			lore: [],
			startScenes: [],
			sceneImages: [],
			...(runtime === undefined
				? {}
				: { runtime: { ...runtime, assets: runtime.assets ?? [] } }),
		});
	const validate = (prepared: ReturnType<typeof prepareStoryPublication>) =>
		validateStoryPublication(prepared.publication, {
			defaultStartSceneResolved: prepared.defaultStartSceneResolved,
			sceneImageIssues: prepared.sceneImageIssues,
			runtimeIssues: prepared.runtimeIssues,
		});
	const promptIssues = (issues: ReturnType<typeof validate>) =>
		issues.filter(
			(i) =>
				i.field === "scenario" && i.code === PUBLICATION_ISSUE_CODE.required,
		);

	it("a publication unaware of runtime refuses an empty prompt", () => {
		expect(promptIssues(validate(prepareEmpty()))).toHaveLength(1);
	});

	it("an explicitly disabled publication refuses an empty prompt too", () => {
		expect(
			promptIssues(
				validate(prepareEmpty({ project: null, files: [], apiVersion: 3 })),
			),
		).toHaveLength(1);
		expect(
			promptIssues(
				validate(
					prepareEmpty({
						project: project(false),
						files: [file("f1", "src/main.tsx")],
						apiVersion: 3,
					}),
				),
			),
		).toHaveLength(1);
	});

	it("a publication carrying runtime source passes an empty prompt", () => {
		const prepared = prepareEmpty({
			project: project(true),
			files: [file("f1", "src/main.tsx")],
			apiVersion: 3,
		});
		expect(prepared.publication.runtime?.mode).toBe("source");
		expect(promptIssues(validate(prepared))).toHaveLength(0);
		expect(validate(prepared)).toEqual([]);
	});

	it("an existing prompt still rides in a runtime source publication", () => {
		const prepared = prepare({
			project: project(true),
			files: [file("f1", "src/main.tsx")],
			apiVersion: 3,
		});
		expect(prepared.publication.play.scenario).toBe(
			"A library where books talk.",
		);
		expect(promptIssues(validate(prepared))).toHaveLength(0);
	});

	/** An empty prompt must not be a pass for a broken runtime. Runtime requirements still apply. */
	it("a broken runtime is blocked even with an empty prompt", () => {
		const prepared = prepareEmpty({
			project: project(true, "src/missing.tsx"),
			files: [file("f1", "src/main.tsx")],
			apiVersion: 3,
		});
		const issues = validate(prepared);
		expect(promptIssues(issues)).toHaveLength(0);
		expect(issues.map((i) => i.code)).toContain(
			PUBLICATION_ISSUE_CODE.runtimeEntryMissing,
		);
	});
});

/**
 * Managed image bindings: what normalization includes and what it drops. Ownership, syntax, and
 * duplicate checks are not here; the server owns them. This builder answers three questions only:
 * are deleted records left out, is the order deterministic, and does the authoring axis stay out of
 * the output?
 */
describe("managed image bindings", () => {
	const source = (assets: DraftRuntimeAsset[]) =>
		prepare({
			project: project(true),
			files: [file("f1", "src/main.tsx")],
			assets,
			apiVersion: 3,
		});

	const bindings = (assets: DraftRuntimeAsset[]) => {
		const runtime = source(assets).publication.runtime;
		if (runtime?.mode !== "source") throw new Error("not a source publication");
		return runtime.project.assets;
	};

	it("only path, media identity and kind ride: authoring axes do not cross", () => {
		expect(bindings([asset("a1", "characters/sena/smile", "media-A")])).toEqual(
			[{ path: "characters/sena/smile", assetId: "media-A", kind: "image" }],
		);
	});

	/**
	 * If `kind` is not sent, the server asks the image predicate instead. Audio would then fail to
	 * unbind at playtime while the publish still succeeds. That failure has no visible symptom, so the
	 * value is pinned by a test.
	 */
	it("sound bindings carry kind: audio", () => {
		expect(bindings([audioAsset("a1", "audio/bgm/main", "media-B")])).toEqual([
			{ path: "audio/bgm/main", assetId: "media-B", kind: "audio" },
		]);
	});

	it("pictures and sounds mix in one namespace by path order", () => {
		expect(
			bindings([
				asset("a2", "ui/heart"),
				audioAsset("a1", "audio/bgm/main"),
			]).map((binding) => `${binding.path}:${binding.kind}`),
		).toEqual(["audio/bgm/main:audio", "ui/heart:image"]);
	});

	it("settles in path order: the store's order does not leak into the publication", () => {
		expect(
			bindings([
				asset("a2", "ui/heart"),
				asset("a1", "backgrounds/library"),
			]).map((binding) => binding.path),
		).toEqual(["backgrounds/library", "ui/heart"]);
	});

	it("deleted assets do not ride", () => {
		const removed = markAuthoringDeleted(
			asset("a1", "characters/sena/smile"),
			"2026-01-02T00:00:00.000Z",
			REV,
		);
		expect(bindings([removed, asset("a2", "ui/heart")])).toEqual([
			{ path: "ui/heart", assetId: "media-a2", kind: "image" },
		]);
	});

	/**
	 * A publish with every asset removed sends an empty array, not nothing. Collapsing the two would
	 * let the publish that removes the last image delete nothing, and the story would keep unused
	 * media forever.
	 */
	it("no assets means an empty array, not absence", () => {
		expect(bindings([])).toEqual([]);
	});

	/**
	 * When the runtime is off, assets have nowhere to go even if present. The only branch is
	 * `disabled`.
	 */
	it("a runtime that is off carries no bindings", () => {
		const prepared = prepare({
			project: project(false),
			files: [],
			assets: [asset("a1", "ui/heart")],
			apiVersion: 3,
		});
		expect(prepared.publication.runtime).toEqual({ mode: "disabled" });
	});
});
