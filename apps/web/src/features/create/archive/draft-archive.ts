import {
	type ArchivedMedia,
	type AuthoringStore,
	buildStoryArchiveManifest,
	CHARACTER_CARD_LIMITS,
	type CharacterCardIssue,
	type CharacterCardLabels,
	characterCardToManifest,
	isPngBytes,
	parseStoryArchiveManifest,
	planStoryArchiveDraft,
	readCharacterCardJson,
	readCharacterCardPng,
	STORY_ARCHIVE_COVER_KEY,
	type StoryArchiveIssueCode,
	type StoryArchiveUpload,
	type StoryDraft,
	storyArchiveMediaNeeds,
	storyArchiveMediaPath,
	storyArchiveUploads,
	type UploadedStoryArchiveMedia,
} from "@rowcat/authoring";
import { classifyRuntimeAssetValue } from "@rowcat/runtime/asset";
import { RowCatApiError } from "@rowcat/sdk";
import type { DraftCoverStore } from "#/lib/local-authoring/draft-cover.ts";
import {
	type ArchiveBytes,
	ArchiveContainerError,
	packStoryArchive,
	unpackStoryArchive,
} from "./zip.ts";

/**
 * Exporting one of my drafts to a file, and opening such a file here as a new draft
 * (docs/oss/STORY-ARCHIVE.md). What the file may hold and how it maps to store inputs is
 * `@rowcat/authoring`'s; this module is the order of operations and the I/O around it.
 *
 * **Import uploads first and writes the draft last.** Every media file is uploaded to this instance
 * before one record is written, so a refused file, a dropped connection or an abort leaves no draft
 * behind — at most a few uploaded media no draft points at. If writing then fails part-way, the half
 * draft is deleted, because a draft missing its scene images is not the work the person brought.
 *
 * **A character card is read as an archive.** A PNG or JSON card from another product is folded into
 * a manifest by `@rowcat/authoring` (character-card.ts) and from then on takes the archive's path —
 * the same check, the same writes. Which one a file is, the bytes say, not the file name.
 *
 * **An import never overwrites.** Each one makes a new draft; importing the same file twice makes two.
 * The archive carries no identity to match against (on purpose — it names no device and no server
 * row), and guessing "this is probably the same story" would pick which one to destroy.
 */

export type DraftArchiveFailure =
	| StoryArchiveIssueCode
	/** A media item the draft points at could not be read from the server (export). */
	| "media_unavailable"
	/** The draft holds a format the archive does not carry (export). */
	| "unsupported_media"
	/** The draft is gone, or belongs to another account (export). */
	| "not_found"
	/** This instance's server refused a file — a format or size it does not accept (import). */
	| "upload_rejected"
	/** An upload did not complete: the network, or the server failing (import). */
	| "upload_failed"
	/** The draft could not be written to this device (import). */
	| "save_failed"
	/** An image with no character card in it (import). */
	| "not_card"
	/** A character card that could not be read (import). */
	| "card_invalid";

export class DraftArchiveError extends Error {
	readonly reason: DraftArchiveFailure;
	constructor(reason: DraftArchiveFailure, detail?: string) {
		super(detail ? `${reason}: ${detail}` : reason);
		this.name = "DraftArchiveError";
		this.reason = reason;
	}
}

export async function sha256Hex(
	bytes: Uint8Array<ArrayBuffer>,
): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", bytes);
	return [...new Uint8Array(digest)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");
}

// ─── Export ─────────────────────────────────────────────────────────────────────────────────────

export interface DraftArchiveExportDeps {
	store: AuthoringStore;
	covers: DraftCoverStore;
	/** Reads one media item's bytes from this instance. Its type is what the server says it stored. */
	fetchMedia: (assetId: string, signal?: AbortSignal) => Promise<Blob>;
	/** This instance's web origin, written as provenance. `null` where it is not known. */
	origin: string | null;
	now: () => string;
}

export async function exportDraftArchive(
	draftId: string,
	deps: DraftArchiveExportDeps,
	signal?: AbortSignal,
): Promise<{ file: Blob; fileName: string }> {
	const { store } = deps;
	const draft = await store.getDraft(draftId);
	if (!draft) throw new DraftArchiveError("not_found");
	const [lore, tools, startScenes, sceneImages, project, cover] =
		await Promise.all([
			store.listLore(draftId),
			store.listTools(draftId),
			store.listStartScenes(draftId),
			store.listSceneImages(draftId),
			store.getRuntimeProject(draftId),
			deps.covers.get(draftId),
		]);
	const runtime = project
		? {
				project,
				files: await store.listRuntimeFiles(draftId),
				assets: await store.listRuntimeAssets(draftId),
			}
		: null;
	const source = {
		draft,
		lore,
		tools,
		startScenes,
		sceneImages,
		runtime,
		hasCover: cover !== null,
	};

	const media = new Map<string, ArchivedMedia>();
	const bytesByPath = new Map<string, Uint8Array>();
	for (const need of storyArchiveMediaNeeds(source)) {
		signal?.throwIfAborted();
		let blob: Blob;
		if (need.key === STORY_ARCHIVE_COVER_KEY && cover) {
			blob = new Blob([cover.blob], { type: cover.mime });
		} else {
			try {
				blob = await deps.fetchMedia(need.key, signal);
			} catch (error) {
				if (signal?.aborted) throw error;
				throw new DraftArchiveError("media_unavailable", need.key);
			}
		}
		const bytes = new Uint8Array(await blob.arrayBuffer());
		const sha256 = await sha256Hex(bytes);
		const mime = blob.type.split(";")[0]?.trim() ?? "";
		const path = storyArchiveMediaPath(sha256, mime);
		if (!path)
			throw new DraftArchiveError("unsupported_media", `${need.role} ${mime}`);
		media.set(need.key, { path, mime, bytes: bytes.byteLength, sha256 });
		bytesByPath.set(path, bytes);
	}

	const built = buildStoryArchiveManifest(source, media, {
		exportedAt: deps.now(),
		origin: deps.origin,
	});
	if (!built.ok)
		throw new DraftArchiveError(built.issue.code, built.issue.detail);
	const zipped = packStoryArchive(built.value, bytesByPath);
	return {
		file: new Blob([zipped], { type: "application/zip" }),
		fileName: storyArchiveFileName(draft),
	};
}

/** A name the person recognises and any file system accepts. The title is the work's name; the suffix says what opens it. */
export function storyArchiveFileName(draft: Pick<StoryDraft, "title">): string {
	const title = draft.title
		// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this strips.
		.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 80);
	return `${title.length > 0 ? title : "story"}.rowcat.zip`;
}

// ─── Import ─────────────────────────────────────────────────────────────────────────────────────

export interface DraftArchiveUploader {
	sceneImage: (
		file: Blob,
		signal?: AbortSignal,
	) => Promise<UploadedStoryArchiveMedia>;
	runtimeImage: (
		file: Blob,
		signal?: AbortSignal,
	) => Promise<UploadedStoryArchiveMedia>;
	runtimeAudio: (
		file: Blob,
		signal?: AbortSignal,
	) => Promise<UploadedStoryArchiveMedia>;
}

export interface DraftArchiveImportProgress {
	uploaded: number;
	total: number;
	/** Set while the server's upload limit holds the next file back, in milliseconds left. */
	waitingMs: number | null;
}

export interface DraftArchiveImportDeps {
	store: AuthoringStore;
	covers: DraftCoverStore;
	upload: DraftArchiveUploader;
	/** Whether the store still belongs to the signed-in account; checked before anything is written. */
	stillOwnsStore: () => boolean;
	wait: (ms: number, signal?: AbortSignal) => Promise<void>;
	onProgress?: (progress: DraftArchiveImportProgress) => void;
	/** The headings and titles a character card's text is placed under, in the screen's language. */
	cardLabels?: CharacterCardLabels;
	/** When a character card became a draft. Defaults to the clock. */
	now?: () => string;
}

/**
 * The server's upload limit is per member and per window (`mediaUpload`), so a draft with many
 * pictures meets it on the way. Waiting it out is the honest path — the person sees how long — and
 * retrying sooner would only be refused again. A failure that is not that limit stops the import.
 */
async function uploadWithLimit<T>(
	run: () => Promise<T>,
	deps: DraftArchiveImportDeps,
	progress: DraftArchiveImportProgress,
	signal?: AbortSignal,
): Promise<T> {
	for (;;) {
		try {
			return await run();
		} catch (error) {
			if (signal?.aborted) throw error;
			if (error instanceof RowCatApiError && error.status === 429) {
				const ms = Math.max(1_000, error.retryAfterMs ?? 30_000);
				deps.onProgress?.({ ...progress, waitingMs: ms });
				await deps.wait(ms, signal);
				deps.onProgress?.({ ...progress, waitingMs: null });
				continue;
			}
			if (
				error instanceof RowCatApiError &&
				error.status >= 400 &&
				error.status < 500
			) {
				throw new DraftArchiveError("upload_rejected", error.code);
			}
			throw new DraftArchiveError("upload_failed", String(error));
		}
	}
}

export async function importDraftArchive(
	file: Blob,
	deps: DraftArchiveImportDeps,
	signal?: AbortSignal,
): Promise<StoryDraft> {
	const unpacked = await readImportFile(
		new Uint8Array(await file.arrayBuffer()),
		deps,
	);
	const parsed = parseStoryArchiveManifest(unpacked.manifest);
	if (!parsed.ok)
		throw new DraftArchiveError(parsed.issue.code, parsed.issue.detail);
	const manifest = parsed.value;

	/**
	 * Asset names are the runtime language's grammar, which `@rowcat/authoring` does not import. The
	 * studio and the publishing server ask the same function; asking it here, before any upload, keeps a
	 * name this instance would refuse at publish from arriving as a draft that can never ship.
	 */
	for (const asset of manifest.runtime?.assets ?? []) {
		if (classifyRuntimeAssetValue(asset.path)?.kind !== "logical") {
			throw new DraftArchiveError(
				"invalid",
				`runtime asset name ${asset.path}`,
			);
		}
	}

	// Every listed file must be present and be the bytes its name says.
	for (const item of manifest.media) {
		const bytes = unpacked.media.get(item.path);
		if (
			!bytes ||
			bytes.byteLength !== item.bytes ||
			(await sha256Hex(bytes)) !== item.sha256
		) {
			throw new DraftArchiveError("media_mismatch", item.path);
		}
	}
	const mimeOf = new Map(manifest.media.map((item) => [item.path, item.mime]));
	const blobOf = (path: string): Blob => {
		const bytes = unpacked.media.get(path) ?? new Uint8Array(0);
		return new Blob([bytes], {
			type: mimeOf.get(path) ?? "application/octet-stream",
		});
	};

	const uploads = storyArchiveUploads(manifest);
	const progress: DraftArchiveImportProgress = {
		uploaded: 0,
		total: uploads.length,
		waitingMs: null,
	};
	deps.onProgress?.(progress);
	const answers = new Map<string, UploadedStoryArchiveMedia>();
	const keyOf = (upload: StoryArchiveUpload) => `${upload.role}:${upload.path}`;
	for (const upload of uploads) {
		signal?.throwIfAborted();
		const blob = blobOf(upload.path);
		const send =
			upload.role === "scene-image"
				? deps.upload.sceneImage
				: upload.role === "runtime-image"
					? deps.upload.runtimeImage
					: deps.upload.runtimeAudio;
		answers.set(
			keyOf(upload),
			await uploadWithLimit(() => send(blob, signal), deps, progress, signal),
		);
		progress.uploaded += 1;
		deps.onProgress?.({ ...progress });
	}

	const plan = planStoryArchiveDraft(manifest, (upload) =>
		answers.get(keyOf(upload)),
	);
	if (!plan.ok) throw new DraftArchiveError(plan.issue.code, plan.issue.detail);
	signal?.throwIfAborted();
	if (!deps.stillOwnsStore())
		throw new DraftArchiveError("save_failed", "account changed");

	const { store } = deps;
	let draft: StoryDraft;
	try {
		draft = await store.createDraft(plan.value.draft);
	} catch (error) {
		throw new DraftArchiveError("save_failed", String(error));
	}
	try {
		for (const entry of plan.value.lore)
			await store.createLore(draft.id, entry);
		for (const tool of plan.value.tools) await store.createTool(draft.id, tool);
		const scenes = [];
		for (const scene of plan.value.startScenes) {
			scenes.push(await store.createStartScene(draft.id, scene));
		}
		const chosen =
			plan.value.defaultStartScene === null
				? undefined
				: scenes[plan.value.defaultStartScene];
		if (chosen) await store.setDefaultStartScene(draft.id, chosen.id);
		for (const image of plan.value.sceneImages)
			await store.createSceneImage(draft.id, image);
		const runtime = plan.value.runtime;
		/**
		 * A runtime with no files is not written: turning on with an empty starter is the state the store
		 * exists to prevent (on, with nothing to run, and no way to make the starter appear later).
		 */
		if (runtime && runtime.starter.files.length > 0) {
			await store.enableRuntime(draft.id, runtime.starter);
			if (!runtime.enabled) await store.setRuntimeEnabled(draft.id, false);
			for (const asset of runtime.assets)
				await store.createRuntimeAsset(draft.id, asset);
		}
		if (plan.value.cover)
			await deps.covers.put(draft.id, blobOf(plan.value.cover));
	} catch (error) {
		await store.deleteDraft(draft.id).catch(() => undefined);
		throw new DraftArchiveError("save_failed", String(error));
	}
	return (await store.getDraft(draft.id)) ?? draft;
}

interface ImportSource {
	/** The manifest value, not yet checked — `parseStoryArchiveManifest` is the one gate for both kinds. */
	manifest: unknown;
	media: ReadonlyMap<string, ArchiveBytes>;
}

/**
 * Tells a story archive from a character card by its first bytes: a zip is an archive, a PNG or a
 * JSON object is a card. A name can be anything a person renamed it to; the bytes cannot.
 */
async function readImportFile(
	bytes: ArchiveBytes,
	deps: Pick<DraftArchiveImportDeps, "cardLabels" | "now">,
): Promise<ImportSource> {
	if (bytes[0] === 0x50 && bytes[1] === 0x4b) return readArchive(bytes);
	if (isPngBytes(bytes)) {
		const read = readCharacterCardPng(bytes);
		if (!read.ok) throw cardError(read.issue);
		const image = read.value.image as ArchiveBytes;
		let cover: ArchivedMedia | null = null;
		const media = new Map<string, ArchiveBytes>();
		// Too large a picture to be a cover arrives as a draft without one, not as no draft.
		if (image.byteLength <= CHARACTER_CARD_LIMITS.coverBytes) {
			const sha256 = await sha256Hex(image);
			const path = storyArchiveMediaPath(sha256, "image/png");
			if (path) {
				cover = { path, mime: "image/png", bytes: image.byteLength, sha256 };
				media.set(path, image);
			}
		}
		return { manifest: convertCard(read.value.card, cover, deps), media };
	}
	if (startsWithJsonObject(bytes)) {
		const read = readCharacterCardJson(bytes);
		if (!read.ok) throw cardError(read.issue);
		return { manifest: convertCard(read.value, null, deps), media: new Map() };
	}
	throw new DraftArchiveError("not_archive", "not a zip, PNG or JSON");
}

function readArchive(bytes: ArchiveBytes): ImportSource {
	let unpacked: ReturnType<typeof unpackStoryArchive>;
	try {
		unpacked = unpackStoryArchive(bytes);
	} catch (error) {
		if (error instanceof ArchiveContainerError) {
			throw new DraftArchiveError(
				error.reason === "too_large" ? "too_large" : "not_archive",
				error.message,
			);
		}
		throw error;
	}
	try {
		return {
			manifest: JSON.parse(unpacked.manifestText),
			media: unpacked.media,
		};
	} catch {
		throw new DraftArchiveError("not_archive", "manifest is not JSON");
	}
}

function convertCard(
	card: unknown,
	cover: ArchivedMedia | null,
	deps: Pick<DraftArchiveImportDeps, "cardLabels" | "now">,
): unknown {
	const converted = characterCardToManifest(card, {
		cover,
		convertedAt: deps.now?.() ?? new Date().toISOString(),
		labels: deps.cardLabels,
	});
	if (!converted.ok) throw cardError(converted.issue);
	return converted.value;
}

function cardError(issue: CharacterCardIssue): DraftArchiveError {
	const reason: DraftArchiveFailure =
		issue.code === "too_large"
			? "too_large"
			: issue.code === "not_card"
				? "not_card"
				: "card_invalid";
	return new DraftArchiveError(reason, issue.detail);
}

/** A byte-order mark and whitespace, then `{`. */
function startsWithJsonObject(bytes: Uint8Array): boolean {
	let index =
		bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? 3 : 0;
	while (
		index < bytes.length &&
		[0x20, 0x09, 0x0a, 0x0d].includes(bytes[index] ?? 0)
	) {
		index += 1;
	}
	return bytes[index] === 0x7b;
}
