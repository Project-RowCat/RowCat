import {
	STORY_ARCHIVE_LIMITS,
	STORY_ARCHIVE_MANIFEST_PATH,
	STORY_ARCHIVE_MEDIA_MAX_BYTES,
} from "@rowcat/authoring";
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

/**
 * The zip container of a story archive (`@rowcat/authoring`'s story-archive.ts owns what is inside).
 *
 * A zip a stranger handed us is the least trustworthy input this screen reads, so the reader decides
 * before inflating anything: the file's own size, then each entry's name, declared size and count.
 * fflate's `filter` sees those from the central directory and an entry it refuses is never inflated.
 * A declared size can lie; what is inflated is then checked again against its sha256 by the caller,
 * so a lie ends as a mismatch rather than as memory.
 *
 * Media go in stored, not deflated — WebP, PNG, JPEG, MP3 and M4A are already compressed, and
 * deflating them buys nothing for the time it costs. The manifest is text and is deflated.
 */

const MEDIA_ENTRY = /^media\/[0-9a-f]{64}\.(webp|png|jpg|gif|mp3|m4a)$/;
const MEDIA_ENTRY_MAX_BYTES = Math.max(
	...Object.values(STORY_ARCHIVE_MEDIA_MAX_BYTES),
);
/** The whole file, compressed. Everything inside is bounded separately below. */
export const STORY_ARCHIVE_FILE_MAX_BYTES =
	STORY_ARCHIVE_LIMITS.manifestBytes + STORY_ARCHIVE_LIMITS.mediaBytes;

export class ArchiveContainerError extends Error {
	readonly reason: "too_large" | "not_zip" | "unexpected_entry" | "no_manifest";
	constructor(reason: ArchiveContainerError["reason"], detail?: string) {
		super(detail ? `${reason}: ${detail}` : reason);
		this.name = "ArchiveContainerError";
		this.reason = reason;
	}
}

/**
 * Bytes backed by a plain `ArrayBuffer`. fflate types its output as `Uint8Array<ArrayBufferLike>`
 * though it never allocates shared memory, and `Blob` and `crypto.subtle` accept only the former.
 */
export type ArchiveBytes = Uint8Array<ArrayBuffer>;

export function packStoryArchive(
	manifest: unknown,
	media: ReadonlyMap<string, Uint8Array>,
): ArchiveBytes {
	const entries: Record<string, [Uint8Array, { level: 0 | 6 }]> = {
		[STORY_ARCHIVE_MANIFEST_PATH]: [
			strToU8(JSON.stringify(manifest, null, 2)),
			{ level: 6 },
		],
	};
	for (const [path, bytes] of media) entries[path] = [bytes, { level: 0 }];
	return zipSync(entries) as ArchiveBytes;
}

export interface UnpackedStoryArchive {
	/** The manifest's text, not yet parsed — parsing and checking are `@rowcat/authoring`'s. */
	manifestText: string;
	media: ReadonlyMap<string, ArchiveBytes>;
}

export function unpackStoryArchive(file: Uint8Array): UnpackedStoryArchive {
	if (file.byteLength > STORY_ARCHIVE_FILE_MAX_BYTES) {
		throw new ArchiveContainerError("too_large", `${file.byteLength} bytes`);
	}
	let declared = 0;
	let count = 0;
	// Written inside fflate's callback, which control-flow narrowing cannot see.
	let refused = null as string | null;
	let entries: Record<string, Uint8Array>;
	try {
		entries = unzipSync(file, {
			filter(entry) {
				if (refused) return false;
				const isManifest = entry.name === STORY_ARCHIVE_MANIFEST_PATH;
				const cap = isManifest
					? STORY_ARCHIVE_LIMITS.manifestBytes
					: MEDIA_ENTRY_MAX_BYTES;
				if (!isManifest && !MEDIA_ENTRY.test(entry.name)) {
					refused = `entry ${entry.name}`;
					return false;
				}
				count += 1;
				declared += entry.originalSize;
				if (
					entry.originalSize > cap ||
					count > STORY_ARCHIVE_LIMITS.media + 1 ||
					declared > STORY_ARCHIVE_FILE_MAX_BYTES
				) {
					refused = `size at ${entry.name}`;
					return false;
				}
				return true;
			},
		});
	} catch (error) {
		throw new ArchiveContainerError("not_zip", String(error));
	}
	if (refused) {
		throw new ArchiveContainerError(
			refused.startsWith("entry") ? "unexpected_entry" : "too_large",
			refused,
		);
	}
	const manifest = entries[STORY_ARCHIVE_MANIFEST_PATH];
	if (!manifest) throw new ArchiveContainerError("no_manifest");
	const media = new Map<string, ArchiveBytes>();
	for (const [name, bytes] of Object.entries(entries)) {
		if (name !== STORY_ARCHIVE_MANIFEST_PATH)
			media.set(name, bytes as ArchiveBytes);
	}
	return { manifestText: strFromU8(manifest), media };
}
