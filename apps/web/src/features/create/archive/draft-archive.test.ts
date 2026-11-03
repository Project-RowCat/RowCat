import { RowCatApiError } from "@rowcat/sdk";
import { afterEach, describe, expect, it } from "vitest";
import { createDraftCoverStore } from "#/lib/local-authoring/draft-cover.ts";
import { createAuthoringStore } from "#/lib/local-authoring/store.ts";
import {
	activateLocalDbScope,
	resetLocalDbScope,
} from "#/lib/local-data/db.ts";
import {
	DraftArchiveError,
	type DraftArchiveUploader,
	exportDraftArchive,
	importDraftArchive,
	storyArchiveFileName,
} from "./draft-archive.ts";
import { packStoryArchive, unpackStoryArchive } from "./zip.ts";

/**
 * Two instances, one person carrying a file between them. Each instance is a separate local
 * database (another member scope) with its own fake server: instance A serves media by id, instance B
 * accepts uploads and issues its own ids. Nothing from A — a draft id, a media id, the publication
 * link — may survive into B's draft, and everything the creator wrote must.
 */

const NOW = "2026-11-03T00:00:00.000Z";
const bytes = (...values: number[]) => new Uint8Array(values);
const blobBytes = async (blob: Blob) => [
	...new Uint8Array(await blob.arrayBuffer()),
];

let viewer = 0;
const instance = () => {
	const db = activateLocalDbScope(`archive-${++viewer}`);
	return { store: createAuthoringStore(db), covers: createDraftCoverStore(db) };
};

afterEach(() => {
	resetLocalDbScope();
});

/** Instance A's server: three media items, each with the type the server stored it as. */
const serverA = new Map<string, Blob>([
	["a-night", new Blob([bytes(1, 2, 3)], { type: "image/webp" })],
	["a-sena", new Blob([bytes(4, 5, 6)], { type: "image/webp" })],
	["a-bgm", new Blob([bytes(7, 8, 9, 10)], { type: "audio/mpeg" })],
]);
const fetchFromA = async (assetId: string) => {
	const blob = serverA.get(assetId);
	if (!blob) throw new Error(`404 ${assetId}`);
	return blob;
};

async function runtimeStoryOnA() {
	const a = instance();
	const draft = await a.store.createDraft({
		title: "The Night Library",
		prompt: "A library where {{char}} keeps the night shift.",
		tags: ["mystery"],
		visibility: "public",
		promptProtected: true,
	});
	await a.store.updateDraft(draft.id, {});
	await a.store.createLore(draft.id, {
		keys: ["ink"],
		content: "Ink remembers.",
		constant: true,
	});
	await a.store.createStartScene(draft.id, {
		title: "Door",
		content: "The door creaks.",
	});
	const desk = await a.store.createStartScene(draft.id, {
		title: "Desk",
		content: "A lamp is on.",
	});
	await a.store.setDefaultStartScene(draft.id, desk.id);
	await a.store.createSceneImage(draft.id, {
		trigger: "night",
		assetId: "a-night",
	});
	await a.store.createSceneImage(draft.id, { trigger: "later", assetId: "" });
	await a.store.enableRuntime(draft.id, {
		entry: "src/main.tsx",
		files: [
			{
				path: "src/main.tsx",
				content:
					'import { Screen } from "@rowcat/runtime";\nexport default () => <Screen />;',
			},
			{ path: "src/systems/score.ts", content: "export const score = 1;" },
		],
	});
	await a.store.createRuntimeAsset(draft.id, {
		kind: "image",
		path: "characters/sena",
		assetId: "a-sena",
		mime: "image/webp",
		width: 640,
		height: 960,
	});
	await a.store.createRuntimeAsset(draft.id, {
		kind: "audio",
		path: "audio/bgm/main",
		assetId: "a-bgm",
		mime: "audio/mpeg",
		durationMs: 1234,
	});
	await a.covers.put(
		draft.id,
		new Blob([bytes(11, 12)], { type: "image/png" }),
	);
	return { a, draftId: draft.id };
}

const exportFromA = (a: ReturnType<typeof instance>, draftId: string) =>
	exportDraftArchive(draftId, {
		store: a.store,
		covers: a.covers,
		fetchMedia: fetchFromA,
		origin: "https://a.example.com",
		now: () => NOW,
	});

/** Instance B's server: records what arrived, answers with its own ids. */
function serverB() {
	const received: { role: string; type: string; bytes: number[] }[] = [];
	let next = 0;
	const answer = (role: string) => async (file: Blob) => {
		received.push({ role, type: file.type, bytes: await blobBytes(file) });
		next += 1;
		return {
			assetId: `b-${next}`,
			mime: file.type,
			width: role === "runtimeImage" ? 640 : null,
			height: role === "runtimeImage" ? 960 : null,
			durationMs: role === "runtimeAudio" ? 1234 : null,
		};
	};
	const upload: DraftArchiveUploader = {
		sceneImage: answer("sceneImage"),
		runtimeImage: answer("runtimeImage"),
		runtimeAudio: answer("runtimeAudio"),
	};
	return { upload, received };
}

const importDeps = (
	b: ReturnType<typeof instance>,
	upload: DraftArchiveUploader,
) => ({
	store: b.store,
	covers: b.covers,
	upload,
	stillOwnsStore: () => true,
	wait: async () => undefined,
});

describe("a runtime story moves between two instances", () => {
	it("arrives as an unpublished draft carrying everything that was written", async () => {
		const { a, draftId } = await runtimeStoryOnA();
		await a.store.updateDraft(draftId, { title: "The Night Library" });
		const exported = await exportFromA(a, draftId);
		expect(exported.fileName).toBe("The Night Library.rowcat.zip");
		resetLocalDbScope();

		const b = instance();
		const { upload, received } = serverB();
		const imported = await importDraftArchive(
			exported.file,
			importDeps(b, upload),
		);

		expect(imported.id).not.toBe(draftId);
		expect(imported.publishedStoryId).toBeNull();
		expect(imported).toMatchObject({
			title: "The Night Library",
			prompt: "A library where {{char}} keeps the night shift.",
			tags: ["mystery"],
			visibility: "public",
			promptProtected: true,
		});

		const lore = await b.store.listLore(imported.id);
		expect(
			lore.map((entry) => [entry.keys, entry.content, entry.constant]),
		).toEqual([[["ink"], "Ink remembers.", true]]);
		const scenes = await b.store.listStartScenes(imported.id);
		expect(scenes.map((scene) => scene.title)).toEqual(["Door", "Desk"]);
		expect(imported.defaultStartSceneId).toBe(scenes[1]?.id);

		const images = await b.store.listSceneImages(imported.id);
		expect(images.map((image) => [image.trigger, image.assetId])).toEqual([
			["night", "b-1"],
			["later", ""],
		]);

		const project = await b.store.getRuntimeProject(imported.id);
		expect(project).toMatchObject({ enabled: true, entry: "src/main.tsx" });
		const files = await b.store.listRuntimeFiles(imported.id);
		expect(files.map((file) => file.path)).toEqual([
			"src/main.tsx",
			"src/systems/score.ts",
		]);
		const assets = await b.store.listRuntimeAssets(imported.id);
		expect(
			assets.map((asset) => [asset.path, asset.kind, asset.assetId]),
		).toEqual([
			["audio/bgm/main", "audio", "b-2"],
			["characters/sena", "image", "b-3"],
		]);

		expect(received).toEqual([
			{ role: "sceneImage", type: "image/webp", bytes: [1, 2, 3] },
			{ role: "runtimeAudio", type: "audio/mpeg", bytes: [7, 8, 9, 10] },
			{ role: "runtimeImage", type: "image/webp", bytes: [4, 5, 6] },
		]);
		const cover = await b.covers.get(imported.id);
		expect(cover?.mime).toBe("image/png");
		expect(cover && (await blobBytes(cover.blob))).toEqual([11, 12]);
	});

	it("waits out the upload limit and carries on", async () => {
		const { a, draftId } = await runtimeStoryOnA();
		const exported = await exportFromA(a, draftId);
		resetLocalDbScope();

		const b = instance();
		const { upload } = serverB();
		let refused = false;
		const waits: number[] = [];
		const progress: (number | null)[] = [];
		const limited: DraftArchiveUploader = {
			...upload,
			runtimeImage: async (file) => {
				if (!refused) {
					refused = true;
					throw new RowCatApiError({
						status: 429,
						code: "media_rate_limited",
						message: "slow down",
						retryAfterMs: 4_000,
					});
				}
				return upload.runtimeImage(file);
			},
		};
		const imported = await importDraftArchive(exported.file, {
			...importDeps(b, limited),
			wait: async (ms: number) => {
				waits.push(ms);
			},
			onProgress: (p) => progress.push(p.waitingMs),
		});
		expect(waits).toEqual([4_000]);
		expect(progress).toContain(4_000);
		expect((await b.store.listRuntimeAssets(imported.id)).length).toBe(2);
	});
});

describe("a plain text story", () => {
	it("round-trips with no runtime and no media", async () => {
		const a = instance();
		const draft = await a.store.createDraft({
			title: "",
			prompt: "Just words.",
		});
		const exported = await exportFromA(a, draft.id);
		expect(exported.fileName).toBe("story.rowcat.zip");
		resetLocalDbScope();

		const b = instance();
		const imported = await importDraftArchive(
			exported.file,
			importDeps(b, serverB().upload),
		);
		expect(imported.prompt).toBe("Just words.");
		expect(await b.store.getRuntimeProject(imported.id)).toBeNull();
		expect(await b.covers.get(imported.id)).toBeNull();
	});
});

describe("what an import refuses", () => {
	const reasonOf = async (promise: Promise<unknown>) => {
		try {
			await promise;
		} catch (error) {
			return error instanceof DraftArchiveError ? error.reason : String(error);
		}
		return "accepted";
	};

	it("a file that is not an archive, and one whose bytes were changed", async () => {
		const { a, draftId } = await runtimeStoryOnA();
		const exported = await exportFromA(a, draftId);
		resetLocalDbScope();
		const b = instance();
		const deps = importDeps(b, serverB().upload);

		expect(
			await reasonOf(importDraftArchive(new Blob([bytes(1, 2, 3)]), deps)),
		).toBe("not_archive");

		const unpacked = unpackStoryArchive(
			new Uint8Array(await exported.file.arrayBuffer()),
		);
		const tampered = new Map(unpacked.media);
		const [path, original] = [...tampered.entries()][0] ?? [];
		if (!path || !original) throw new Error("no media");
		tampered.set(
			path,
			original.map((value) => value ^ 1),
		);
		const repacked = packStoryArchive(
			JSON.parse(unpacked.manifestText),
			tampered,
		);
		expect(await reasonOf(importDraftArchive(new Blob([repacked]), deps))).toBe(
			"media_mismatch",
		);
		expect(await b.store.listDrafts()).toEqual([]);
	});

	it("a refused upload leaves no draft, and a failed write removes the half draft", async () => {
		const { a, draftId } = await runtimeStoryOnA();
		const exported = await exportFromA(a, draftId);
		resetLocalDbScope();
		const b = instance();
		const { upload } = serverB();

		const rejecting: DraftArchiveUploader = {
			...upload,
			runtimeAudio: async () => {
				throw new RowCatApiError({
					status: 400,
					code: "media_unsupported_format",
					message: "no",
				});
			},
		};
		expect(
			await reasonOf(
				importDraftArchive(exported.file, importDeps(b, rejecting)),
			),
		).toBe("upload_rejected");
		expect(await b.store.listDrafts()).toEqual([]);

		const brokenCovers = {
			...b.covers,
			put: async () => {
				throw new Error("disk full");
			},
		};
		expect(
			await reasonOf(
				importDraftArchive(exported.file, {
					...importDeps(b, upload),
					covers: brokenCovers,
				}),
			),
		).toBe("save_failed");
		expect(await b.store.listDrafts()).toEqual([]);
	});

	it("an asset name the runtime language does not accept, before anything is uploaded", async () => {
		const { a, draftId } = await runtimeStoryOnA();
		const exported = await exportFromA(a, draftId);
		resetLocalDbScope();
		const b = instance();
		const { upload, received } = serverB();
		const unpacked = unpackStoryArchive(
			new Uint8Array(await exported.file.arrayBuffer()),
		);
		const manifest = JSON.parse(unpacked.manifestText);
		manifest.runtime.assets[0].path = "https://tracker.example.com/pixel.png";
		const repacked = packStoryArchive(manifest, unpacked.media);
		expect(
			await reasonOf(
				importDraftArchive(new Blob([repacked]), importDeps(b, upload)),
			),
		).toBe("invalid");
		expect(received).toEqual([]);
	});
});

describe("file name", () => {
	it("keeps the title readable and drops what file systems refuse", () => {
		expect(storyArchiveFileName({ title: ' 밤의 도서관: a/b "c" ' })).toBe(
			"밤의 도서관 a b c.rowcat.zip",
		);
	});
});
