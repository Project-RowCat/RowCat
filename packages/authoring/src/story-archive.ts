import { ChatLorePosition } from "@rowcat/contracts/chat";
import { Orientation } from "@rowcat/contracts/gallery";
import {
	RUNTIME_AUDIO_LIMITS,
	RUNTIME_IMAGE_LIMITS,
	SCENE_IMAGE_LIMITS,
} from "@rowcat/contracts/media";
import { STORY_COVER_LIMITS } from "@rowcat/contracts/story-cover";
import { StoryVisibility } from "@rowcat/contracts/story-visibility";
import { z } from "zod";
import {
	type CreateStoryDraftInput,
	type DraftLoreEntry,
	type DraftSceneImage,
	type DraftStartScene,
	isLiveRecord,
	type StoryDraft,
	sortLore,
	sortSceneImages,
	sortStartScenes,
} from "./model.ts";
import {
	checkRuntimePath,
	type DraftRuntimeAsset,
	type DraftRuntimeFile,
	type DraftRuntimeProject,
	type NewDraftRuntimeAsset,
	RUNTIME_PROJECT_LIMITS,
	type RuntimeStarter,
	sortRuntimeAssets,
	sortRuntimeFiles,
} from "./runtime.ts";
import type {
	NewDraftLoreEntry,
	NewDraftSceneImage,
	NewDraftStartScene,
} from "./store.ts";

/**
 * The story archive: one of my drafts as a file another RowCat instance can open as a new draft
 * (docs/oss/STORY-ARCHIVE.md). There is no federation behind it — a person carries the file.
 *
 * What it carries is **what the creator wrote**, and nothing that names a person or a device:
 * - No member id, nickname, email, session or sync key. The archive moves a work, not an account.
 * - No `publishedStoryId`, revision, `fieldRev`, `dirty` or tombstone. Those describe this device's
 *   copy, and on another instance they would point at nothing — an imported draft is unpublished.
 * - No media id. An id names a row on the exporting server; the bytes travel instead, and the
 *   importing device uploads them to its own server, which issues new ids. A file path is the
 *   content's sha256, so the same picture used twice is one file.
 *
 * The draft is the unit, not the published work, because the server never holds runtime source
 * (it compiles and discards it) and the draft is the creator's original. Only drafts on this device
 * can be exported, which is also the answer to "whose work is this": the exporter wrote it.
 *
 * This module is pure: no zip, no hashing, no network. The app reads the store and the bytes,
 * hashes them, and zips; on import it unzips, verifies the hashes, uploads, then writes the draft.
 * The rules — the shape, the limits, which media a draft needs, and how a manifest becomes store
 * inputs — live here so web and a later mobile importer answer the same way.
 */

export const STORY_ARCHIVE_FORMAT = "rowcat-story";
/**
 * Raised only when an older importer must refuse the file — a field it would drop is a field the
 * creator loses. Adding an optional field an older importer can ignore is not a version.
 */
export const STORY_ARCHIVE_VERSION = 1;
export const STORY_ARCHIVE_MANIFEST_PATH = "rowcat-story.json";

/**
 * These bound what one import may cost the importing device and server, not what is publishable:
 * publishing re-validates against the publication limits, and a draft in progress may hold more
 * than a work may ship (the store does not enforce the publish caps either). Counts the product
 * itself enforces — runtime files and assets — are the product's numbers.
 */
export const STORY_ARCHIVE_LIMITS = {
	/** The manifest's own size in bytes. The prompt has no length cap; this is the one that binds. */
	manifestBytes: 32 * 1024 * 1024,
	/** All media bytes together. The whole archive is read into memory on import. */
	mediaBytes: 256 * 1024 * 1024,
	text: 2_000_000,
	shortText: 10_000,
	tags: 100,
	lore: 1_000,
	loreKeys: 200,
	startScenes: 200,
	sceneImages: 200,
	runtimeFiles: RUNTIME_PROJECT_LIMITS.files,
	runtimeAssets: RUNTIME_PROJECT_LIMITS.assets,
	/** A cover, every scene image and every runtime asset, each as a distinct file. */
	media: 1 + 200 + RUNTIME_PROJECT_LIMITS.assets,
} as const;

/**
 * Formats a file may hold, by what it is for. Images that went through the server are WebP; the
 * cover never did (the device holds the original until publication), so it keeps the formats the
 * cover upload accepts. The upload on the importing side re-validates every byte regardless.
 */
const IMAGE_MEDIA = {
	"image/webp": "webp",
	"image/png": "png",
	"image/jpeg": "jpg",
	"image/gif": "gif",
} as const;
const AUDIO_MEDIA = {
	"audio/mpeg": "mp3",
	"audio/mp4": "m4a",
} as const;
const MEDIA_EXTENSIONS: Record<string, string> = {
	...IMAGE_MEDIA,
	...AUDIO_MEDIA,
};

export type StoryArchiveMediaRole =
	| "cover"
	| "scene-image"
	| "runtime-image"
	| "runtime-audio";

/** Byte caps per role — the importing server's own upload caps, so a file it would refuse is refused here first. */
export const STORY_ARCHIVE_MEDIA_MAX_BYTES: Record<
	StoryArchiveMediaRole,
	number
> = {
	cover: STORY_COVER_LIMITS.maxAnimatedBytes,
	"scene-image": SCENE_IMAGE_LIMITS.maxBytes,
	"runtime-image": RUNTIME_IMAGE_LIMITS.maxBytes,
	"runtime-audio": RUNTIME_AUDIO_LIMITS.maxBytes,
};

const roleAccepts = (role: StoryArchiveMediaRole, mime: string): boolean =>
	role === "runtime-audio" ? mime in AUDIO_MEDIA : mime in IMAGE_MEDIA;

/**
 * The file name a media item takes in the archive, or `null` for a format the archive does not
 * carry. The name is derived from the bytes, so a reader can check it, and two uses of the same
 * picture share one file.
 */
export function storyArchiveMediaPath(
	sha256: string,
	mime: string,
): string | null {
	const extension = MEDIA_EXTENSIONS[mime];
	if (!extension || !/^[0-9a-f]{64}$/.test(sha256)) return null;
	return `media/${sha256}.${extension}`;
}

const MediaPath = z
	.string()
	.regex(/^media\/[0-9a-f]{64}\.(webp|png|jpg|gif|mp3|m4a)$/);
const text = (max: number) => z.string().max(max);

const ArchiveRuntimeAsset = z.discriminatedUnion("kind", [
	z
		.object({
			kind: z.literal("image"),
			path: text(RUNTIME_PROJECT_LIMITS.path),
			media: MediaPath,
		})
		.strict(),
	z
		.object({
			kind: z.literal("audio"),
			path: text(RUNTIME_PROJECT_LIMITS.path),
			media: MediaPath,
		})
		.strict(),
]);

export const StoryArchiveManifest = z
	.object({
		format: z.literal(STORY_ARCHIVE_FORMAT),
		version: z.literal(STORY_ARCHIVE_VERSION),
		exportedAt: z.iso.datetime(),
		/**
		 * Where the file came from, for the person reading it. The web origin of the exporting
		 * instance, or `null` when that was not known. Not an identity and not a permission: the
		 * importer does not store it and nothing checks it.
		 */
		source: z.object({ origin: text(2_048).nullable() }).strict(),
		story: z
			.object({
				title: text(STORY_ARCHIVE_LIMITS.shortText),
				tagline: text(STORY_ARCHIVE_LIMITS.shortText),
				description: text(STORY_ARCHIVE_LIMITS.text),
				tags: z
					.array(text(STORY_ARCHIVE_LIMITS.shortText))
					.max(STORY_ARCHIVE_LIMITS.tags),
				orientation: Orientation.nullable(),
				adult: z.boolean(),
				visibility: StoryVisibility,
				promptProtected: z.boolean(),
				prompt: text(STORY_ARCHIVE_LIMITS.text * 8),
				/** Index into `startScenes`, or `null` when none was chosen. Ids do not travel. */
				defaultStartScene: z.number().int().nonnegative().nullable(),
			})
			.strict(),
		cover: MediaPath.nullable(),
		lore: z
			.array(
				z
					.object({
						keys: z
							.array(text(STORY_ARCHIVE_LIMITS.shortText))
							.max(STORY_ARCHIVE_LIMITS.loreKeys),
						content: text(STORY_ARCHIVE_LIMITS.text),
						constant: z.boolean(),
						position: ChatLorePosition,
						order: z.number().int(),
					})
					.strict(),
			)
			.max(STORY_ARCHIVE_LIMITS.lore),
		startScenes: z
			.array(
				z
					.object({
						title: text(STORY_ARCHIVE_LIMITS.shortText),
						content: text(STORY_ARCHIVE_LIMITS.text),
					})
					.strict(),
			)
			.max(STORY_ARCHIVE_LIMITS.startScenes),
		sceneImages: z
			.array(
				z
					.object({
						trigger: text(STORY_ARCHIVE_LIMITS.shortText),
						/** `null` while the creator has not chosen an image yet — the draft keeps that slot. */
						image: MediaPath.nullable(),
					})
					.strict(),
			)
			.max(STORY_ARCHIVE_LIMITS.sceneImages),
		runtime: z
			.object({
				enabled: z.boolean(),
				entry: text(RUNTIME_PROJECT_LIMITS.path),
				files: z
					.array(
						z
							.object({
								path: text(RUNTIME_PROJECT_LIMITS.path),
								content: text(RUNTIME_PROJECT_LIMITS.content * 2),
							})
							.strict(),
					)
					.max(STORY_ARCHIVE_LIMITS.runtimeFiles),
				assets: z
					.array(ArchiveRuntimeAsset)
					.max(STORY_ARCHIVE_LIMITS.runtimeAssets),
			})
			.strict()
			.nullable(),
		media: z
			.array(
				z
					.object({
						path: MediaPath,
						mime: text(100),
						bytes: z.number().int().positive(),
						sha256: z.string().regex(/^[0-9a-f]{64}$/),
					})
					.strict(),
			)
			.max(STORY_ARCHIVE_LIMITS.media),
	})
	.strict();
export type StoryArchiveManifest = z.infer<typeof StoryArchiveManifest>;
export type StoryArchiveMedia = StoryArchiveManifest["media"][number];

export type StoryArchiveIssueCode =
	/** Not a RowCat story archive at all. */
	| "not_archive"
	/** Written by a newer RowCat than this one; importing it would drop what this version does not know. */
	| "newer_version"
	/** The manifest breaks the shape or a limit. `detail` names where. */
	| "invalid"
	/** A media file the manifest names is absent, or its bytes do not match. */
	| "media_mismatch"
	/** The archive is larger than one import may be. */
	| "too_large";

export interface StoryArchiveIssue {
	code: StoryArchiveIssueCode;
	/** Where it went wrong, for a developer or a bug report. Not screen copy. */
	detail?: string;
}

export type StoryArchiveResult<T> =
	| { ok: true; value: T }
	| { ok: false; issue: StoryArchiveIssue };

const fail = (
	code: StoryArchiveIssueCode,
	detail?: string,
): { ok: false; issue: StoryArchiveIssue } => ({
	ok: false,
	issue: detail === undefined ? { code } : { code, detail },
});

// ─── Export ─────────────────────────────────────────────────────────────────────────────────────

/** The draft as the store holds it. Deleted children are dropped here, not by the caller. */
export interface StoryArchiveSource {
	draft: StoryDraft;
	lore: readonly DraftLoreEntry[];
	startScenes: readonly DraftStartScene[];
	sceneImages: readonly DraftSceneImage[];
	runtime: {
		project: DraftRuntimeProject;
		files: readonly DraftRuntimeFile[];
		assets: readonly DraftRuntimeAsset[];
	} | null;
	/** Whether this device holds a cover for the draft. Its bytes are the app's to read. */
	hasCover: boolean;
}

/** A media item the export must fetch. `key` is the server media id, or `"cover"` for the device-held cover. */
export interface StoryArchiveMediaNeed {
	key: string;
	role: StoryArchiveMediaRole;
}

export const STORY_ARCHIVE_COVER_KEY = "cover";

/**
 * The media one export must read, each once. A media id belongs to one kind on its server, so one
 * id never needs two roles.
 */
export function storyArchiveMediaNeeds(
	source: StoryArchiveSource,
): StoryArchiveMediaNeed[] {
	const needs: StoryArchiveMediaNeed[] = [];
	const seen = new Set<string>();
	const add = (key: string, role: StoryArchiveMediaRole) => {
		if (key.length === 0 || seen.has(key)) return;
		seen.add(key);
		needs.push({ key, role });
	};
	if (source.hasCover) add(STORY_ARCHIVE_COVER_KEY, "cover");
	for (const image of source.sceneImages.filter(isLiveRecord)) {
		add(image.assetId, "scene-image");
	}
	for (const asset of source.runtime?.assets.filter(isLiveRecord) ?? []) {
		add(
			asset.assetId,
			asset.kind === "audio" ? "runtime-audio" : "runtime-image",
		);
	}
	return needs;
}

/** One fetched media item, hashed by the app. `path` comes from `storyArchiveMediaPath`. */
export interface ArchivedMedia {
	path: string;
	mime: string;
	bytes: number;
	sha256: string;
}

/**
 * Builds the manifest from the store's records and the media the app fetched (keyed like
 * `storyArchiveMediaNeeds`). The result is checked against the same schema an importer uses, so a
 * draft this function accepts is one another instance can open.
 */
export function buildStoryArchiveManifest(
	source: StoryArchiveSource,
	media: ReadonlyMap<string, ArchivedMedia>,
	meta: { exportedAt: string; origin: string | null },
): StoryArchiveResult<StoryArchiveManifest> {
	const pathOf = (key: string): string | null => media.get(key)?.path ?? null;
	const missing: string[] = [];
	const need = (key: string): string => {
		const path = pathOf(key);
		if (path === null) missing.push(key);
		return path ?? "";
	};

	const startScenes = sortStartScenes(source.startScenes.filter(isLiveRecord));
	const defaultIndex = startScenes.findIndex(
		(scene) => scene.id === source.draft.defaultStartSceneId,
	);
	const { draft } = source;

	const runtime = source.runtime
		? {
				enabled: source.runtime.project.enabled,
				entry: source.runtime.project.entry,
				files: sortRuntimeFiles(source.runtime.files.filter(isLiveRecord)).map(
					(file) => ({ path: file.path, content: file.content }),
				),
				assets: sortRuntimeAssets(
					source.runtime.assets.filter(isLiveRecord),
				).map((asset) => ({
					kind: asset.kind,
					path: asset.path,
					media: need(asset.assetId),
				})),
			}
		: null;

	const manifest = {
		format: STORY_ARCHIVE_FORMAT,
		version: STORY_ARCHIVE_VERSION,
		exportedAt: meta.exportedAt,
		source: { origin: meta.origin },
		story: {
			title: draft.title,
			tagline: draft.tagline,
			description: draft.description,
			tags: [...draft.tags],
			orientation: draft.orientation,
			adult: draft.adult,
			visibility: draft.visibility,
			promptProtected: draft.promptProtected,
			prompt: draft.prompt,
			defaultStartScene: defaultIndex === -1 ? null : defaultIndex,
		},
		cover: source.hasCover ? need(STORY_ARCHIVE_COVER_KEY) : null,
		lore: sortLore(source.lore.filter(isLiveRecord)).map((entry) => ({
			keys: [...entry.keys],
			content: entry.content,
			constant: entry.constant,
			position: entry.position,
			order: entry.order,
		})),
		startScenes: startScenes.map((scene) => ({
			title: scene.title,
			content: scene.content,
		})),
		sceneImages: sortSceneImages(source.sceneImages.filter(isLiveRecord)).map(
			(image) => ({
				trigger: image.trigger,
				image: image.assetId.length === 0 ? null : need(image.assetId),
			}),
		),
		runtime,
		media: dedupeMedia([...media.values()]),
	};
	if (missing.length > 0) {
		return fail("media_mismatch", `not fetched: ${missing.join(", ")}`);
	}
	return checkStoryArchiveManifest(manifest);
}

function dedupeMedia(items: readonly ArchivedMedia[]): StoryArchiveMedia[] {
	const byPath = new Map<string, StoryArchiveMedia>();
	for (const item of items) {
		if (!byPath.has(item.path)) {
			byPath.set(item.path, {
				path: item.path,
				mime: item.mime,
				bytes: item.bytes,
				sha256: item.sha256,
			});
		}
	}
	return [...byPath.values()].sort((a, b) => (a.path < b.path ? -1 : 1));
}

// ─── Import ─────────────────────────────────────────────────────────────────────────────────────

/**
 * Reads a manifest someone handed us. The order of questions matters: "is this ours at all", then
 * "is it from a newer version", and only then the shape — so a newer archive is never reported as
 * broken, which would send the person hunting for damage that is not there.
 */
export function parseStoryArchiveManifest(
	input: unknown,
): StoryArchiveResult<StoryArchiveManifest> {
	if (
		typeof input !== "object" ||
		input === null ||
		(input as { format?: unknown }).format !== STORY_ARCHIVE_FORMAT
	) {
		return fail("not_archive");
	}
	const version = (input as { version?: unknown }).version;
	if (typeof version === "number" && version > STORY_ARCHIVE_VERSION) {
		return fail("newer_version", `version ${version}`);
	}
	return checkStoryArchiveManifest(input);
}

/** The shape, then what a schema cannot say: references resolve, names match bytes, totals fit. */
function checkStoryArchiveManifest(
	input: unknown,
): StoryArchiveResult<StoryArchiveManifest> {
	const parsed = StoryArchiveManifest.safeParse(input);
	if (!parsed.success) {
		const issue = parsed.error.issues[0];
		return fail(
			"invalid",
			issue ? `${issue.path.join(".")}: ${issue.message}` : undefined,
		);
	}
	const manifest = parsed.data;

	const media = new Map<string, StoryArchiveMedia>();
	let total = 0;
	for (const item of manifest.media) {
		if (media.has(item.path))
			return fail("invalid", `media ${item.path} listed twice`);
		if (storyArchiveMediaPath(item.sha256, item.mime) !== item.path) {
			return fail(
				"invalid",
				`media ${item.path} does not match its sha256 and mime`,
			);
		}
		media.set(item.path, item);
		total += item.bytes;
	}
	if (total > STORY_ARCHIVE_LIMITS.mediaBytes)
		return fail("too_large", `${total} media bytes`);

	const used = new Set<string>();
	const use = (path: string, role: StoryArchiveMediaRole): string | null => {
		const item = media.get(path);
		if (!item) return `${path} is not listed`;
		if (!roleAccepts(role, item.mime))
			return `${path} (${item.mime}) cannot be a ${role}`;
		if (item.bytes > STORY_ARCHIVE_MEDIA_MAX_BYTES[role])
			return `${path} is too large for a ${role}`;
		used.add(path);
		return null;
	};
	const problems: string[] = [];
	const check = (problem: string | null) => {
		if (problem) problems.push(problem);
	};

	if (manifest.cover) check(use(manifest.cover, "cover"));
	for (const image of manifest.sceneImages) {
		if (image.image) check(use(image.image, "scene-image"));
	}
	if (
		manifest.story.defaultStartScene !== null &&
		manifest.story.defaultStartScene >= manifest.startScenes.length
	) {
		problems.push("story.defaultStartScene points past startScenes");
	}

	if (manifest.runtime) {
		const files = new Set<string>();
		for (const file of manifest.runtime.files) {
			const path = checkRuntimePath(file.path);
			if (!path.ok) problems.push(`runtime file ${file.path}: ${path.code}`);
			if (files.has(file.path))
				problems.push(`runtime file ${file.path} listed twice`);
			files.add(file.path);
		}
		if (
			manifest.runtime.files.length > 0 &&
			!files.has(manifest.runtime.entry)
		) {
			problems.push(`runtime entry ${manifest.runtime.entry} is not a file`);
		}
		const assets = new Set<string>();
		for (const asset of manifest.runtime.assets) {
			if (assets.has(asset.path))
				problems.push(`runtime asset ${asset.path} listed twice`);
			assets.add(asset.path);
			check(
				use(
					asset.media,
					asset.kind === "audio" ? "runtime-audio" : "runtime-image",
				),
			);
		}
	}

	for (const path of media.keys()) {
		if (!used.has(path)) problems.push(`media ${path} is not used`);
	}
	if (problems.length > 0) return fail("invalid", problems[0]);
	return { ok: true, value: manifest };
}

/** One upload the importing device must make. Files used in two roles upload once per role: on the server the kind is the authorization. */
export interface StoryArchiveUpload {
	path: string;
	role: Exclude<StoryArchiveMediaRole, "cover">;
}

/** What to upload, in a stable order and each (file, role) once. The cover stays on the device, as it did on the exporting one. */
export function storyArchiveUploads(
	manifest: StoryArchiveManifest,
): StoryArchiveUpload[] {
	const uploads: StoryArchiveUpload[] = [];
	const seen = new Set<string>();
	const add = (path: string, role: StoryArchiveUpload["role"]) => {
		const key = `${role}:${path}`;
		if (seen.has(key)) return;
		seen.add(key);
		uploads.push({ path, role });
	};
	for (const image of manifest.sceneImages) {
		if (image.image) add(image.image, "scene-image");
	}
	for (const asset of manifest.runtime?.assets ?? []) {
		add(
			asset.media,
			asset.kind === "audio" ? "runtime-audio" : "runtime-image",
		);
	}
	return uploads;
}

/** What the importing server answered for one upload. */
export interface UploadedStoryArchiveMedia {
	assetId: string;
	mime: string;
	width: number | null;
	height: number | null;
	durationMs: number | null;
}

/**
 * Everything the store needs to write the new draft, in the order it must be written. Positions and
 * ids are the store's to assign, so the plan carries list order, not numbers.
 */
export interface StoryArchiveDraftPlan {
	draft: CreateStoryDraftInput;
	/** The archive file holding the cover, which the app puts in the device's cover store. */
	cover: string | null;
	lore: NewDraftLoreEntry[];
	startScenes: NewDraftStartScene[];
	/** Index into `startScenes`, applied after they exist. */
	defaultStartScene: number | null;
	sceneImages: NewDraftSceneImage[];
	runtime: {
		enabled: boolean;
		starter: RuntimeStarter;
		assets: NewDraftRuntimeAsset[];
	} | null;
}

/**
 * Turns a checked manifest and the import's uploads into store inputs.
 *
 * An imported draft is unpublished whatever the archive says: it has no `publishedStoryId`, and an
 * archived visibility (a state of a published work, not a publishing target) arrives as private.
 * Publishing it on this instance is a separate press, re-checked by this instance's server.
 */
export function planStoryArchiveDraft(
	manifest: StoryArchiveManifest,
	uploaded: (
		upload: StoryArchiveUpload,
	) => UploadedStoryArchiveMedia | undefined,
): StoryArchiveResult<StoryArchiveDraftPlan> {
	const missing: string[] = [];
	const take = (
		upload: StoryArchiveUpload,
	): UploadedStoryArchiveMedia | null => {
		const result = uploaded(upload);
		if (!result) missing.push(`${upload.role}:${upload.path}`);
		return result ?? null;
	};

	const { story } = manifest;
	const sceneImages: NewDraftSceneImage[] = manifest.sceneImages.map(
		(image) => ({
			trigger: image.trigger,
			assetId: image.image
				? (take({ path: image.image, role: "scene-image" })?.assetId ?? "")
				: "",
		}),
	);

	let runtime: StoryArchiveDraftPlan["runtime"] = null;
	if (manifest.runtime) {
		const assets: NewDraftRuntimeAsset[] = [];
		for (const asset of manifest.runtime.assets) {
			if (asset.kind === "audio") {
				const result = take({ path: asset.media, role: "runtime-audio" });
				if (result) {
					assets.push({
						kind: "audio",
						path: asset.path,
						assetId: result.assetId,
						mime: result.mime,
						durationMs: result.durationMs ?? 0,
					});
				}
			} else {
				const result = take({ path: asset.media, role: "runtime-image" });
				if (result) {
					assets.push({
						kind: "image",
						path: asset.path,
						assetId: result.assetId,
						mime: result.mime,
						width: result.width ?? 0,
						height: result.height ?? 0,
					});
				}
			}
		}
		runtime = {
			enabled: manifest.runtime.enabled,
			starter: {
				entry: manifest.runtime.entry,
				files: manifest.runtime.files.map((file) => ({
					path: file.path,
					content: file.content,
				})),
			},
			assets,
		};
	}
	if (missing.length > 0) {
		return fail("media_mismatch", `not uploaded: ${missing.join(", ")}`);
	}

	return {
		ok: true,
		value: {
			draft: {
				title: story.title,
				tagline: story.tagline,
				description: story.description,
				tags: [...story.tags],
				orientation: story.orientation,
				adult: story.adult,
				visibility:
					story.visibility === "archived" ? "private" : story.visibility,
				promptProtected: story.promptProtected,
				prompt: story.prompt,
			},
			cover: manifest.cover,
			lore: manifest.lore.map((entry) => ({
				keys: [...entry.keys],
				content: entry.content,
				constant: entry.constant,
				position: entry.position,
				order: entry.order,
			})),
			startScenes: manifest.startScenes.map((scene) => ({
				title: scene.title,
				content: scene.content,
			})),
			defaultStartScene: story.defaultStartScene,
			sceneImages,
			runtime,
		},
	};
}
