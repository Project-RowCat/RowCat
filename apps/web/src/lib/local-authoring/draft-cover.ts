import type { LocalDb } from "#/lib/local-data/db.ts";

/**
 * The cover the device holds for a draft before publishing: storage shape and read boundary.
 *
 * Why a draft needs its own cover: The source of truth for covers is the server's `story_cover`
 * table, keyed by `story_id`. An unpublished draft has no work row yet, so there is structurally
 * nothing to attach a cover to. Until publishing, a pre-publish cover cannot be sent to the server,
 * so it has to be kept somewhere else.
 *
 * unpublished draft   kept here (IndexedDB), then PUT /stories/:id/cover on publish
 * published draft     the server holds it; cover management edits the server directly (not here)
 *
 * Invariant of this module: those two states can never both be true at once. When publishing
 * succeeds and the bytes are uploaded, this row is deleted. If it were kept, the server's cover and
 * the device's cover would diverge, and the screen would have no basis for deciding which one to
 * draw.
 *
 * What is not here: There is no dirty, rev, serverVersion, or tombstone. These values are not
 * synced. They are absent from the codec registry and from TABLE_ORDER, and the protocol does not
 * know they exist. This is the same class as generationPreferences and providerConnections. The
 * point is that an axis missing from the schema shows up as missing. If it were present, someone
 * would eventually fill it.
 *
 * The cost is recorded honestly. Opening the same draft on another device shows no cover. This is a
 * chosen trade-off, not a defect. The alternative is shipping multi-MB images through the sync
 * envelope, which brings envelope size, codec version bumps, and transfer volume along with it.
 * That is a different decision. Once published, the cover goes to the server, and every device sees
 * the same thing from then on.
 *
 * The AuthoringStore port does not carry these methods, for the same reason. That port is a shared
 * contract that a later Expo SQLite implementation will fill. This value is a temporary store for
 * this one web device.
 */

/**
 * Schema version. The reader ignores rows of an unknown version entirely.
 *
 * This value is needed because the row lasts a long time on the user's device. If the storage
 * format changes and old rows cannot be recognized, a half-read image would be drawn broken. That
 * is worse than nothing. (Same reasoning as local-generation/record.ts.)
 */
export const DRAFT_COVER_VERSION = 1;

export interface StoredDraftCover {
	draftId: string;
	version: number;
	/**
	 * Stored exactly as the chosen file. Nothing is downscaled or converted here. Normalization is the
	 * job of one boundary on the server (apps/api/src/lib/cover-image.ts). If the client did it too,
	 * the same rules would exist in two places, and the picture would differ before and after
	 * publishing.
	 */
	blob: Blob;
	/**
	 * The format as the browser reported it. This is for display, not validation; the server judges by
	 * the bytes.
	 */
	mime: string;
	size: number;
	updatedAt: string;
}

export interface StagedDraftCover {
	draftId: string;
	blob: Blob;
	mime: string;
	size: number;
	updatedAt: string;
}

/**
 * A reader that does not trust the row. If the version differs or `blob` is not a Blob, the row is
 * treated as absent.
 *
 * The second check exists because this value passes through structured cloning into IndexedDB. An
 * old browser or an old version may have left it in a different shape. If it failed only after
 * being passed to `URL.createObjectURL`, the whole screen would die.
 */
export function readDraftCover(
	row: StoredDraftCover | undefined,
): StagedDraftCover | null {
	if (!row || row.version !== DRAFT_COVER_VERSION) return null;
	if (!(row.blob instanceof Blob)) return null;
	return {
		draftId: row.draftId,
		blob: row.blob,
		mime: row.mime,
		size: row.size,
		updatedAt: row.updatedAt,
	};
}

/**
 * The pre-publish cover store: one device, one member.
 *
 * Writes do not trigger automatic sync (local-data/stores.ts does not wrap this port). A write like
 * this has nothing to upload, so triggering sync would be a pure waste of a round trip.
 */
export interface DraftCoverStore {
	get(draftId: string): Promise<StagedDraftCover | null>;
	put(draftId: string, file: Blob): Promise<StagedDraftCover>;
	remove(draftId: string): Promise<void>;
}

export function createDraftCoverStore(db: LocalDb): DraftCoverStore {
	return {
		async get(draftId) {
			return readDraftCover(await db.draftCovers.get(draftId));
		},

		async put(draftId, file) {
			const row: StoredDraftCover = {
				draftId,
				version: DRAFT_COVER_VERSION,
				blob: file,
				/**
				 * `file.type` can be an empty string (a file with no extension). In that case nothing is
				 * guessed and the empty value is kept as is. This field is used only when the screen names the
				 * format. The real judgment is made on publish by the server, from the bytes.
				 */
				mime: file.type,
				size: file.size,
				updatedAt: new Date().toISOString(),
			};
			await db.draftCovers.put(row);
			return {
				draftId,
				blob: row.blob,
				mime: row.mime,
				size: row.size,
				updatedAt: row.updatedAt,
			};
		},

		async remove(draftId) {
			/**
			 * Hard delete. No tombstone is left, because nothing would read it. This table is not synced, so
			 * there is no device to tell that it was deleted. Leaving a row would keep image bytes on the
			 * device forever that no one reads.
			 */
			await db.draftCovers.delete(draftId);
		},
	};
}
