import type { MediaKind } from "@rowcat/contracts";

/**
 * Media byte storage: one port, and no vendor passes this file.
 *
 * The media service must not know where bytes live, so swapping storage is one adapter. A vendor
 * SDK (`@aws-sdk/*`, `@cloudflare/*`) must not climb above this file, or its types spread into
 * services, routes and tests.
 *
 * - The surface is three key-value methods. `list()` is deliberately absent: it would turn
 *   cleanup into "scan storage for orphans", inverting the design where metadata is the source of
 *   truth (ask the `media` table for orphans).
 * - There is no `getPublicUrl`, on purpose. A storage-built address points at the bucket
 *   directly, which removes the place access control sits (bytes with a non-`ready` status become
 *   readable), leaves no point to add a later safety check, and breaks already-issued HTML and
 *   caches when storage changes. Bytes always leave through our route (`routes/media.ts`); the
 *   address derives from the media id (`mediaUrl` in `services/media.ts`) and the storage key stays
 *   internal.
 */

export interface MediaBlobStore {
	/**
	 * Writes bytes to a key. Overwrite is not assumed: keys derive from freshly issued media ids, so
	 * the same key is not written twice on the normal path, which is what makes URLs immutable.
	 *
	 * `mime` is for object-storage adapters (S3/R2 store `Content-Type` with the object); the Postgres
	 * adapter ignores it. Adding it to the signature later would change every call site.
	 */
	put(key: string, bytes: Buffer, mime: string): Promise<void>;

	/** Bytes at the key, or `null` when absent (not an error; an orphan pointer is a normal state). */
	get(key: string): Promise<Buffer | null>;

	/**
	 * One slice of the bytes, `[start, endExclusive)`. Optional so the port can express an adapter
	 * that cannot do ranges (fold to `get`). It exists for audio: seeking sends range requests, and
	 * loading a 10MiB object into memory to send 64KiB would repeat dozens of times per track.
	 *
	 * A range outside the resource returns an empty buffer, not `null`: `null` means "no such key",
	 * and folding the two would stop the route telling 416 from 404.
	 */
	getRange?(
		key: string,
		start: number,
		endExclusive: number,
	): Promise<Buffer | null>;

	/**
	 * Deletes the key; idempotent. Callers are all cleanup, which is retried, and a retry that failed
	 * on a missing key would leave the orphan forever.
	 */
	delete(key: string): Promise<void>;
}

/**
 * Issues a storage key with no user input in it: a fixed prefix, the closed `kind` vocabulary and
 * two ids we issued. The original filename never reaches the server (the contract has no slot,
 * `packages/contracts/src/media.ts`).
 *
 * ```text
 * media/avatar/<ownerId>/<mediaId>.webp
 * ```
 *
 * Path injection is unrepresentable (`newId()` gives 32 hex characters), but the segments are
 * asserted again because a broken invariant would silently write into someone else's slot.
 *
 * The owner id is in the path for operations (grouping per member for deletion and usage
 * inspection), never for authorization: that is the `media.owner` column, since using the path
 * would let anyone who can invent a path invent authorization. No emails or nicknames: storage keys
 * land in logs, backups and CDN records.
 */
export function buildStorageKey(input: {
	kind: MediaKind;
	ownerId: string;
	mediaId: string;
	/** The decided format of the stored bytes; the extension derives only from this. */
	mime: string;
}): string {
	assertKeySegment(input.ownerId, "ownerId");
	assertKeySegment(input.mediaId, "mediaId");
	return `media/${input.kind}/${input.ownerId}/${input.mediaId}${extensionFor(input.mime)}`;
}

/**
 * Key extension derived from the format; an unknown format gets none. It was once a `.webp`
 * literal, which became false when audio arrived (an MP3 ending in `.webp`). It is an operations
 * convenience, never used for authorization (`media.mime` decides what is served), and a guessed
 * extension could lie where a missing one cannot.
 */
function extensionFor(mime: string): string {
	switch (mime) {
		case "image/webp":
			return ".webp";
		case "audio/mpeg":
			return ".mp3";
		case "audio/mp4":
			return ".m4a";
		default:
			return "";
	}
}

/**
 * Throws on purpose: failure here means our id issuer broke, not user input, and continuing would
 * write bytes to an unintended slot. It is not an `ApiError` because there is nothing to tell the
 * user (500, logged).
 */
function assertKeySegment(value: string, name: string): void {
	if (!/^[a-zA-Z0-9_-]+$/.test(value))
		throw new Error(
			`[media] ${name} contains characters that can't be used in a storage key`,
		);
}
