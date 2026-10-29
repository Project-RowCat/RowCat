import type { MobileDatabase } from "./sqlite.ts";
import type { SqlRow } from "./tables.ts";

/**
 * The **one cover image** a pre-publication draft holds on this device. Both the row and the file
 * are handled here.
 *
 * Same place and same invariant as the web's `lib/local-authoring/draft-cover.ts`:
 *
 * ```text
 * Unpublished draft   here; at publish, PUT /stories/:id/cover, and this row and file disappear
 * Published draft     the server holds it; "cover management" edits the server directly (it never comes here)
 * ```
 *
 * ## Why not on the `AuthoringStore` port
 *
 * That port is a shared contract that the web and this app both fill (`@rowcat/authoring`), and
 * every value in it is a synced record. A pre-publication cover is the opposite: a temporary
 * holding that the device keeps only until publication. If it entered the port, the next consumer
 * would read it as a synced value. The web separates the same spot for the same reason.
 *
 * ## The row and the file move **within one function**
 *
 * No transaction spans the two stores. So the order sets the direction, and when they diverge they
 * must diverge in the **less harmful** way:
 *
 * ```text
 * On place    file first, then row   a lone file is overwritten by the next `stage` (one orphan)
 * On remove   row first, then file   a lone row is overwritten by the next `stage` (one orphan)
 * ```
 *
 * The opposite order creates **a row pointing at a file that does not exist**. That row becomes a
 * broken cover on screen, and the user cannot do anything about it. An orphan file is seen by no
 * one.
 */

/**
 * Schema version. The reader **ignores rows of an unknown version entirely.**
 *
 * This value is needed because such a row stays on the user's device for a long time. On the day
 * the storage format changes, if nothing can recognize an old row, the reader would partially read
 * it and draw a broken image. That is worse than drawing nothing (same judgment as the web's
 * `DRAFT_COVER_VERSION`).
 */
export const DRAFT_COVER_VERSION = 1;

/**
 * The four members that touch the file location. **Received by injection.**
 *
 * The whole reason this file does not import `expo-file-system` is this port. The file **enters the
 * test graph** through scope assembly, and that setup has no polyfills. `vitest.config.ts` records
 * the absence as a rule: code that passed against a faked native module breaks first on device. The
 * SQLite driver and Keychain have the same shape for the same reason.
 *
 * So what is verified here is **the order of rows and files**. Whether a file is actually moved
 * belongs to its implementation (`lib/draft-cover-files.ts`) and to device QA.
 */
export interface DraftCoverFiles {
	/** Stored name to the address on this device right now. */
	uri(dirName: string, fileName: string): string;
	/** Moves the chosen image into that place. Returns the name and the actual byte count. */
	stage(
		dirName: string,
		draftId: string,
		source: { uri: string; mimeType: string | null },
	): Promise<{ fileName: string; byteSize: number }>;
	/** Deletes one file. Succeeds even if it is absent. */
	remove(dirName: string, fileName: string): void;
	/** This draft's candidate names (the extension varies). The last resort when the row is lost. */
	candidates(draftId: string): readonly string[];
}

/** One cover this device holds. **A name, not an address** (see the ⚠️ in `draft-cover-files.ts`). */
export interface StagedDraftCover {
	draftId: string;
	fileName: string;
	/** The format the picker reported. **For display only, not validation** (the server judges by the bytes). */
	mime: string | null;
	byteSize: number;
	updatedAt: string;
	/**
	 * **An address built at each read.** Not stored.
	 *
	 * Handed out here so the screen does not join name and location. If that assembly leaked into
	 * feature folders, someone might eventually freeze an absolute path, and that row would point at a
	 * file missing after reinstall (see the ⚠️ in `draft-cover-files.ts`).
	 */
	uri: string;
}

export interface DraftCoverStore {
	/** `null` if none. A row of an unknown version is also `null`. */
	get(draftId: string): Promise<StagedDraftCover | null>;
	/** Places the chosen image on this device. The earlier cover for the same draft is overwritten. */
	stage(
		draftId: string,
		source: { uri: string; mimeType: string | null },
	): Promise<StagedDraftCover>;
	/** Clears the row and the file together. Succeeds even if absent. */
	clear(draftId: string): Promise<void>;
}

const SELECT = `SELECT draft_id, version, file_name, mime, byte_size, updated_at FROM authoring_draft_cover`;

const toStaged = (
	files: DraftCoverFiles,
	dirName: string,
	row: SqlRow,
): StagedDraftCover | null => {
	/**
	 * **An unknown version is read as absent.** Reading it partially and drawing it would show a
	 * broken cover, and the user would think the image they picked was damaged. Absence is the
	 * accurate answer.
	 */
	if (Number(row.version ?? 0) !== DRAFT_COVER_VERSION) return null;
	const fileName = String(row.file_name ?? "");
	if (!fileName) return null;
	return {
		draftId: String(row.draft_id ?? ""),
		fileName,
		mime: row.mime === null || row.mime === undefined ? null : String(row.mime),
		byteSize: Number(row.byte_size ?? 0),
		updatedAt: String(row.updated_at ?? ""),
		uri: files.uri(dirName, fileName),
	};
};

export function createMobileDraftCoverStore(
	db: MobileDatabase,
	/** This member's cover directory (`viewerDraftCoverDirName`). Deriving the name happens outside. */
	dirName: string,
	files: DraftCoverFiles,
): DraftCoverStore {
	return {
		async get(draftId) {
			const row = await db.first<SqlRow>(`${SELECT} WHERE draft_id = ?`, [
				draftId,
			]);
			return row ? toStaged(files, dirName, row) : null;
		},

		async stage(draftId, source) {
			/**
			 * **The file goes first.** If the row were written first and the copy then failed, a row would
			 * remain pointing at no file, and it would show as a broken cover on screen.
			 */
			const placed = await files.stage(dirName, draftId, source);
			const staged: StagedDraftCover = {
				draftId,
				fileName: placed.fileName,
				mime: source.mimeType,
				byteSize: placed.byteSize,
				updatedAt: new Date().toISOString(),
				uri: files.uri(dirName, placed.fileName),
			};
			/**
			 * If the extension changes, the name changes too (jpg to png). The previous file is not
			 * overwritten, so it is removed here. There is only one row, so nothing else points at that
			 * file.
			 */
			const previous = await this.get(draftId);
			if (previous && previous.fileName !== staged.fileName)
				files.remove(dirName, previous.fileName);

			await db.run(
				`INSERT INTO authoring_draft_cover (draft_id, version, file_name, mime, byte_size, updated_at)
				 VALUES (?, ?, ?, ?, ?, ?)
				 ON CONFLICT(draft_id) DO UPDATE SET
				   version = excluded.version,
				   file_name = excluded.file_name,
				   mime = excluded.mime,
				   byte_size = excluded.byte_size,
				   updated_at = excluded.updated_at`,
				[
					draftId,
					DRAFT_COVER_VERSION,
					staged.fileName,
					staged.mime,
					staged.byteSize,
					staged.updatedAt,
				],
			);
			return staged;
		},

		async clear(draftId) {
			/**
			 * **The row goes first.** If the file were removed first, there would be a window where the row
			 * remains but the file is gone, and during that window the screen would draw a broken cover.
			 *
			 * The name is read from the row because of the extension. A file placed in an unknown format is
			 * `bin`, so rebuilding the name from the current mime would fail to find it. Only when there is
			 * no row does this guess the name (below).
			 */
			const existing = await this.get(draftId);
			await db.run(`DELETE FROM authoring_draft_cover WHERE draft_id = ?`, [
				draftId,
			]);
			if (existing) {
				files.remove(dirName, existing.fileName);
				return;
			}
			/**
			 * There is no row, but **a file may still remain** (a run that died after placing the file and
			 * before writing the row). It sweeps only the known extensions. The name is determined by the
			 * draft id, so this guess never reaches someone else's file.
			 */
			for (const name of files.candidates(draftId)) files.remove(dirName, name);
		},
	};
}
