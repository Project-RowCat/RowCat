import { describe, expect, it } from "vitest";
import {
	createDraftLoreEntryRecord,
	createDraftSceneImageRecord,
	createDraftStartSceneRecord,
	createStoryDraftRecord,
	markAuthoringDeleted,
} from "./model.ts";
import {
	createDraftRuntimeAssetRecord,
	createDraftRuntimeFileRecord,
	createDraftRuntimeProjectRecord,
} from "./runtime.ts";
import {
	type ArchivedMedia,
	buildStoryArchiveManifest,
	parseStoryArchiveManifest,
	planStoryArchiveDraft,
	STORY_ARCHIVE_COVER_KEY,
	type StoryArchiveManifest,
	type StoryArchiveSource,
	storyArchiveMediaNeeds,
	storyArchiveMediaPath,
	storyArchiveUploads,
} from "./story-archive.ts";

const NOW = "2026-11-03T00:00:00.000Z";
const REV = { t: 1_793_000_000_000, c: 0, d: "device-a" };
const stamp = (id: string) => ({ id, now: NOW, rev: REV });
const hash = (n: number) => n.toString(16).padStart(64, "0");

function source(
	overrides: Partial<StoryArchiveSource> = {},
): StoryArchiveSource {
	const draft = {
		...createStoryDraftRecord(
			{
				title: "The Night Library",
				tagline: "Books talk after midnight",
				tags: ["mystery"],
				adult: false,
				visibility: "public",
				promptProtected: true,
				prompt: "A library where {{char}} keeps the night shift.",
			},
			stamp("draft-1"),
		),
		publishedStoryId: "story-on-instance-a",
		defaultStartSceneId: "scene-b",
	};
	return {
		draft,
		lore: [
			createDraftLoreEntryRecord(
				{
					draftId: "draft-1",
					positionIndex: 1,
					keys: ["ink"],
					content: "Ink remembers.",
				},
				stamp("lore-2"),
			),
			createDraftLoreEntryRecord(
				{
					draftId: "draft-1",
					positionIndex: 0,
					keys: ["key"],
					content: "The key is brass.",
				},
				stamp("lore-1"),
			),
			markAuthoringDeleted(
				createDraftLoreEntryRecord(
					{ draftId: "draft-1", positionIndex: 2, content: "deleted" },
					stamp("lore-3"),
				),
				NOW,
				REV,
			),
		],
		startScenes: [
			createDraftStartSceneRecord(
				{
					draftId: "draft-1",
					position: 0,
					title: "Door",
					content: "The door creaks.",
				},
				stamp("scene-a"),
			),
			createDraftStartSceneRecord(
				{
					draftId: "draft-1",
					position: 1,
					title: "Desk",
					content: "A lamp is on.",
				},
				stamp("scene-b"),
			),
		],
		sceneImages: [
			createDraftSceneImageRecord(
				{
					draftId: "draft-1",
					position: 0,
					trigger: "night",
					assetId: "media-night",
				},
				stamp("image-1"),
			),
			createDraftSceneImageRecord(
				{ draftId: "draft-1", position: 1, trigger: "unchosen", assetId: "" },
				stamp("image-2"),
			),
		],
		runtime: {
			project: createDraftRuntimeProjectRecord(
				{ draftId: "draft-1", enabled: true, entry: "src/main.tsx" },
				{ now: NOW, rev: REV },
			),
			files: [
				createDraftRuntimeFileRecord(
					{
						draftId: "draft-1",
						path: "src/main.tsx",
						content: "export default 1;",
					},
					stamp("file-1"),
				),
			],
			assets: [
				createDraftRuntimeAssetRecord(
					{
						draftId: "draft-1",
						path: "bgm/main",
						kind: "audio",
						assetId: "media-bgm",
						mime: "audio/mpeg",
						durationMs: 1000,
					},
					stamp("asset-1"),
				),
				createDraftRuntimeAssetRecord(
					{
						draftId: "draft-1",
						path: "characters/sena",
						kind: "image",
						assetId: "media-sena",
						mime: "image/webp",
						width: 10,
						height: 20,
					},
					stamp("asset-2"),
				),
			],
		},
		hasCover: true,
		...overrides,
	};
}

const media = (
	key: string,
	n: number,
	mime: string,
): [string, ArchivedMedia] => [
	key,
	{
		path: storyArchiveMediaPath(hash(n), mime) ?? "",
		mime,
		bytes: 100 + n,
		sha256: hash(n),
	},
];

const allMedia = () =>
	new Map([
		media(STORY_ARCHIVE_COVER_KEY, 1, "image/png"),
		media("media-night", 2, "image/webp"),
		media("media-bgm", 3, "audio/mpeg"),
		media("media-sena", 4, "image/webp"),
	]);

function built(): StoryArchiveManifest {
	const result = buildStoryArchiveManifest(source(), allMedia(), {
		exportedAt: NOW,
		origin: "https://rowcat.example.com",
	});
	if (!result.ok) throw new Error(JSON.stringify(result.issue));
	return result.value;
}

describe("export", () => {
	it("asks for each media item once, by what it is for", () => {
		expect(storyArchiveMediaNeeds(source())).toEqual([
			{ key: "cover", role: "cover" },
			{ key: "media-night", role: "scene-image" },
			{ key: "media-bgm", role: "runtime-audio" },
			{ key: "media-sena", role: "runtime-image" },
		]);
	});

	it("carries what was written and nothing that names a person, a device or a server row", () => {
		const manifest = built();
		const text = JSON.stringify(manifest);
		for (const absent of [
			"story-on-instance-a",
			"draft-1",
			"device-a",
			"media-night",
			"lore-1",
			"scene-b",
		]) {
			expect(text).not.toContain(absent);
		}
		expect(manifest.story.defaultStartScene).toBe(1);
		expect(manifest.lore.map((entry) => entry.content)).toEqual([
			"The key is brass.",
			"Ink remembers.",
		]);
		expect(manifest.sceneImages[1]).toEqual({
			trigger: "unchosen",
			image: null,
		});
		expect(manifest.runtime?.assets.map((asset) => asset.path)).toEqual([
			"bgm/main",
			"characters/sena",
		]);
	});

	it("refuses to build when a media item was not fetched", () => {
		const fetched = allMedia();
		fetched.delete("media-bgm");
		const result = buildStoryArchiveManifest(source(), fetched, {
			exportedAt: NOW,
			origin: null,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.issue.code).toBe("media_mismatch");
	});

	it("names a file by its bytes, and only for formats it carries", () => {
		expect(storyArchiveMediaPath(hash(9), "audio/mp4")).toBe(
			`media/${hash(9)}.m4a`,
		);
		expect(storyArchiveMediaPath(hash(9), "image/svg+xml")).toBeNull();
		expect(storyArchiveMediaPath("not-a-hash", "image/png")).toBeNull();
	});
});

describe("import", () => {
	it("reads back what export built", () => {
		const manifest = built();
		expect(
			parseStoryArchiveManifest(JSON.parse(JSON.stringify(manifest))),
		).toEqual({
			ok: true,
			value: manifest,
		});
	});

	it("tells a newer archive apart from a broken one", () => {
		const newer = { ...built(), version: 2, somethingNew: true };
		expect(parseStoryArchiveManifest(newer)).toMatchObject({
			ok: false,
			issue: { code: "newer_version" },
		});
		expect(parseStoryArchiveManifest({ hello: 1 })).toMatchObject({
			ok: false,
			issue: { code: "not_archive" },
		});
		expect(parseStoryArchiveManifest({ ...built(), extra: 1 })).toMatchObject({
			ok: false,
			issue: { code: "invalid" },
		});
	});

	it("refuses references that do not resolve, files nobody uses and roles a format cannot fill", () => {
		const manifest = built();
		const dangling = { ...manifest, cover: `media/${hash(99)}.png` };
		expect(parseStoryArchiveManifest(dangling)).toMatchObject({
			ok: false,
			issue: { code: "invalid" },
		});

		const unused = {
			...manifest,
			media: [
				...manifest.media,
				{
					path: `media/${hash(98)}.png`,
					mime: "image/png",
					bytes: 1,
					sha256: hash(98),
				},
			],
		};
		expect(parseStoryArchiveManifest(unused)).toMatchObject({
			ok: false,
			issue: { code: "invalid" },
		});

		const audioAsCover = { ...manifest, cover: `media/${hash(3)}.mp3` };
		expect(parseStoryArchiveManifest(audioAsCover)).toMatchObject({
			ok: false,
			issue: { code: "invalid" },
		});

		const traversal = {
			...manifest,
			runtime: manifest.runtime && {
				...manifest.runtime,
				files: [{ path: "../etc/passwd.ts", content: "" }],
			},
		};
		expect(parseStoryArchiveManifest(traversal)).toMatchObject({
			ok: false,
			issue: { code: "invalid" },
		});
	});

	it("refuses a file named for different bytes", () => {
		const manifest = built();
		const [first, ...rest] = manifest.media;
		if (!first) throw new Error("no media");
		const renamed = {
			...manifest,
			media: [{ ...first, sha256: hash(77) }, ...rest],
		};
		expect(parseStoryArchiveManifest(renamed)).toMatchObject({
			ok: false,
			issue: { code: "invalid" },
		});
	});

	it("uploads each file once per role and keeps the cover on the device", () => {
		expect(storyArchiveUploads(built())).toEqual([
			{ path: `media/${hash(2)}.webp`, role: "scene-image" },
			{ path: `media/${hash(3)}.mp3`, role: "runtime-audio" },
			{ path: `media/${hash(4)}.webp`, role: "runtime-image" },
		]);
	});

	it("plans an unpublished draft from the new server's answers", () => {
		const manifest = built();
		const plan = planStoryArchiveDraft(manifest, (upload) => ({
			assetId: `new-${upload.role}`,
			mime: upload.role === "runtime-audio" ? "audio/mpeg" : "image/webp",
			width: upload.role === "runtime-image" ? 10 : null,
			height: upload.role === "runtime-image" ? 20 : null,
			durationMs: upload.role === "runtime-audio" ? 1000 : null,
		}));
		if (!plan.ok) throw new Error(JSON.stringify(plan.issue));
		expect(plan.value.draft).not.toHaveProperty("publishedStoryId");
		expect(plan.value.draft.visibility).toBe("public");
		expect(plan.value.sceneImages).toEqual([
			{ trigger: "night", assetId: "new-scene-image" },
			{ trigger: "unchosen", assetId: "" },
		]);
		expect(plan.value.runtime?.assets).toEqual([
			{
				kind: "audio",
				path: "bgm/main",
				assetId: "new-runtime-audio",
				mime: "audio/mpeg",
				durationMs: 1000,
			},
			{
				kind: "image",
				path: "characters/sena",
				assetId: "new-runtime-image",
				mime: "image/webp",
				width: 10,
				height: 20,
			},
		]);
		expect(plan.value.defaultStartScene).toBe(1);
		expect(plan.value.cover).toBe(manifest.cover);
	});

	it("never imports an archived visibility, and stops when an upload is missing", () => {
		const manifest = {
			...built(),
			story: { ...built().story, visibility: "archived" as const },
		};
		const archived = planStoryArchiveDraft(manifest, () => ({
			assetId: "x",
			mime: "image/webp",
			width: 1,
			height: 1,
			durationMs: 1,
		}));
		expect(archived.ok && archived.value.draft.visibility).toBe("private");
		expect(planStoryArchiveDraft(built(), () => undefined)).toMatchObject({
			ok: false,
			issue: { code: "media_mismatch" },
		});
	});
});
