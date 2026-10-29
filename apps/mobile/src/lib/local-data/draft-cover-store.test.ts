import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createTempDirectory,
	openNodeSqliteDriver,
} from "../../test/sqlite-node.ts";
import { openMobileDatabase, viewerDraftCoverDirName } from "./database.ts";
import {
	createMobileDraftCoverStore,
	DRAFT_COVER_VERSION,
	type DraftCoverFiles,
} from "./draft-cover-store.ts";
import { deleteLocalDataForViewer } from "./purge.ts";
import type { MobileDatabase } from "./sqlite.ts";

/**
 * SQLite adapter for pre-publication covers. **The order in which the row and the file are
 * touched** is the whole of this suite.
 *
 * The file is a fake (`expo-file-system` does not enter this graph, see `vitest.config.ts`). What
 * is still verified is meaningful, because what this repository must actually guarantee is **the
 * order in which the two places are touched**. No transaction spans the two stores, so when they
 * diverge they must diverge in the **less harmful** way.
 *
 * ```text
 * On place    file first, then row   a lone file is overwritten by the next `stage` (one orphan)
 * On remove   row first, then file   a lone row is overwritten by the next `stage` (one orphan)
 * ```
 *
 * The opposite order creates **a row pointing at a file that does not exist**, and that row becomes
 * a broken cover on screen.
 */

let temp: ReturnType<typeof createTempDirectory>;

beforeEach(() => {
	temp = createTempDirectory();
});

afterEach(() => {
	temp.dispose();
});

const open = (name = "cover.db"): Promise<MobileDatabase> =>
	openMobileDatabase(openNodeSqliteDriver(temp.path, name));

const DIR = "draft-covers-abc";

/** A fake file place that records the order of calls. That order is what this suite observes. */
function fakeFiles() {
	const calls: string[] = [];
	const placed = new Set<string>();
	return {
		calls,
		placed,
		files: {
			uri: (dirName, fileName) => `file:///${dirName}/${fileName}`,
			stage: async (_dirName, draftId, source) => {
				calls.push("stage");
				const extension = source.mimeType === "image/png" ? "png" : "jpg";
				const fileName = `${draftId}.${extension}`;
				placed.add(fileName);
				return { fileName, byteSize: 1024 };
			},
			remove: (_dirName, fileName) => {
				calls.push(`remove:${fileName}`);
				placed.delete(fileName);
			},
			candidates: (draftId) => [`${draftId}.jpg`, `${draftId}.png`],
		} satisfies DraftCoverFiles,
	};
}

const jpeg = { uri: "file:///picked.jpg", mimeType: "image/jpeg" };
const png = { uri: "file:///picked.png", mimeType: "image/png" };

describe("release", () => {
	it("moves the file first, then writes the row", async () => {
		const db = await open();
		const { calls, files } = fakeFiles();
		const store = createMobileDraftCoverStore(db, DIR, files);

		await store.stage("d1", jpeg);
		/** Writing the row first would leave **a row pointing at no file** if the copy failed. */
		expect(calls[0]).toBe("stage");

		const staged = await store.get("d1");
		expect(staged?.fileName).toBe("d1.jpg");
		expect(staged?.mime).toBe("image/jpeg");
		/** The size comes from **the placed file**, not from the picker. */
		expect(staged?.byteSize).toBe(1024);
		await db.close();
	});

	/**
	 * The address is **not stored**. It is built from the place and the name at each read. Writing an
	 * absolute path would make the row point at a file missing after reinstall (see the ⚠️ in
	 * `draft-cover-files.ts`).
	 */
	it("doesn't store the address; builds it on read", async () => {
		const db = await open();
		const { files } = fakeFiles();
		const store = createMobileDraftCoverStore(db, DIR, files);
		await store.stage("d1", jpeg);

		const row = await db.first<{ file_name: string }>(
			"SELECT * FROM authoring_draft_cover WHERE draft_id = 'd1'",
		);
		expect(row?.file_name).toBe("d1.jpg");
		/** No column contains `file:///`. */
		expect(JSON.stringify(row)).not.toContain("file:///");
		expect((await store.get("d1"))?.uri).toBe(`file:///${DIR}/d1.jpg`);
		await db.close();
	});

	/** Choosing again is an **overwrite**. There is only one row. */
	it("choosing again leaves one row", async () => {
		const db = await open();
		const { files } = fakeFiles();
		const store = createMobileDraftCoverStore(db, DIR, files);
		await store.stage("d1", jpeg);
		await store.stage("d1", jpeg);

		const rows = await db.all<{ draft_id: string }>(
			"SELECT draft_id FROM authoring_draft_cover",
		);
		expect(rows).toHaveLength(1);
		await db.close();
	});

	/**
	 * **If the extension changes, the earlier file is not overwritten.** The name differs, so nothing
	 * points at that file any more. If it is not removed, it becomes an orphan that no one can find.
	 */
	it("clears the previous file when the extension changes", async () => {
		const db = await open();
		const { calls, placed, files } = fakeFiles();
		const store = createMobileDraftCoverStore(db, DIR, files);
		await store.stage("d1", jpeg);
		calls.length = 0;
		await store.stage("d1", png);

		expect(calls).toContain("remove:d1.jpg");
		expect(placed.has("d1.jpg")).toBe(false);
		expect(placed.has("d1.png")).toBe(true);
		expect((await store.get("d1"))?.fileName).toBe("d1.png");
		await db.close();
	});
});

describe("deleting", () => {
	it("deletes the row first, then the file", async () => {
		const db = await open();
		const { calls, files } = fakeFiles();
		const store = createMobileDraftCoverStore(db, DIR, files);
		await store.stage("d1", jpeg);
		calls.length = 0;

		await store.clear("d1");
		/**
		 * Removing the file first would create **a window where the row remains but the file is gone**,
		 * and in that window the screen draws a broken cover. The row is already absent, so this call
		 * touches one file only.
		 */
		expect(calls).toEqual(["remove:d1.jpg"]);
		expect(await store.get("d1")).toBeNull();
		await db.close();
	});

	/**
	 * **A file may still remain even when there is no row.** A run that died after placing the file
	 * and before writing the row is one such case. The name is determined by the draft id, so that
	 * guess never reaches someone else's file.
	 */
	it("without a row it scans the candidate names", async () => {
		const db = await open();
		const { calls, files } = fakeFiles();
		const store = createMobileDraftCoverStore(db, DIR, files);

		await store.clear("d1");
		expect(calls).toEqual(["remove:d1.jpg", "remove:d1.png"]);
		await db.close();
	});

	/** Does not touch another draft's cover. */
	it("deletes only that draft's", async () => {
		const db = await open();
		const { files } = fakeFiles();
		const store = createMobileDraftCoverStore(db, DIR, files);
		await store.stage("d1", jpeg);
		await store.stage("d2", jpeg);

		await store.clear("d1");
		expect(await store.get("d1")).toBeNull();
		expect((await store.get("d2"))?.fileName).toBe("d2.jpg");
		await db.close();
	});
});

describe("reading", () => {
	/**
	 * **An unknown version is read as absent.** Reading it partially and drawing it would show a
	 * broken cover, and the user would think the picked image was damaged. Absence is the accurate
	 * answer.
	 */
	it("a row of an unknown version is absent", async () => {
		const db = await open();
		const { files } = fakeFiles();
		const store = createMobileDraftCoverStore(db, DIR, files);
		await db.run(
			`INSERT INTO authoring_draft_cover (draft_id, version, file_name, mime, byte_size, updated_at)
			 VALUES ('d1', ?, 'd1.jpg', 'image/jpeg', 1, '2026-09-06T00:00:00.000Z')`,
			[DRAFT_COVER_VERSION + 1],
		);
		expect(await store.get("d1")).toBeNull();
		await db.close();
	});

	it("null when missing", async () => {
		const db = await open();
		const { files } = fakeFiles();
		const store = createMobileDraftCoverStore(db, DIR, files);
		expect(await store.get("nope")).toBeNull();
		await db.close();
	});
});

describe("no sync axes in the schema", () => {
	/**
	 * "Covers are not synced" must be **a fact of the schema, not a promise in a comment.** If a
	 * column existed, someone would eventually fill it, and at that moment multi-MB images would ride
	 * in the envelope.
	 */
	it("not a single dirty, server_version, rev or tombstone column", async () => {
		const db = await open();
		const columns = await db.all<{ name: string }>(
			"PRAGMA table_info(authoring_draft_cover)",
		);
		const names = columns.map((column) => column.name).sort();
		expect(names).toEqual([
			"byte_size",
			"draft_id",
			"file_name",
			"mime",
			"updated_at",
			"version",
		]);
		await db.close();
	});
});

/**
 * When a member leaves: **cover files are also this device's local data.**
 *
 * Per-member locations are the premise of this cleanup (`viewerDraftCoverDirName`). The reason not
 * to build a sweep by prefix is that **other members'** files on the same device would vanish too.
 * That is the accident `purge.ts` was written to avoid from the start.
 */
describe("cleanup on deletion and reset", () => {
	const targets = () => {
		const calls: string[] = [];
		return {
			calls,
			ports: {
				deleteDatabase: async (name: string) => {
					calls.push(`db:${name}`);
				},
				secureStorage: {
					get: async () => null,
					set: async () => undefined,
					remove: async (key: string) => {
						calls.push(`secure:${key}`);
					},
				},
				deleteDraftCovers: (dirName: string) => {
					calls.push(`covers:${dirName}`);
				},
			},
		};
	};

	/**
	 * **Cover files come before the database.** If this step failed in the reverse order, the member's
	 * covers would remain as files that point to no row, and the next run would lose the basis for
	 * finding them.
	 */
	it("clears the cover place before the database", async () => {
		const { calls, ports } = targets();
		await deleteLocalDataForViewer("viewer-1", ports);
		const covers = calls.findIndex((call) => call.startsWith("covers:"));
		const database = calls.findIndex((call) => call.startsWith("db:"));
		expect(covers).toBeGreaterThan(-1);
		expect(database).toBeGreaterThan(covers);
	});

	/** The place name belongs to **that member**. Its derivation is the same function as the database name's. */
	it("clears only that member's place", async () => {
		const { calls, ports } = targets();
		await deleteLocalDataForViewer("viewer-1", ports);
		expect(calls).toContain(`covers:${viewerDraftCoverDirName("viewer-1")}`);
		expect(calls).not.toContain(
			`covers:${viewerDraftCoverDirName("viewer-2")}`,
		);
		/** The member id does not remain in plain text, because this place is backed up with the device. */
		expect(viewerDraftCoverDirName("viewer-1")).not.toContain("viewer-1");
	});
});
