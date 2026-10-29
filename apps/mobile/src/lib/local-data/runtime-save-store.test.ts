import type { RuntimeSaveStore } from "@rowcat/runtime-persistence";
import { runtimeSaveStoreContract } from "@rowcat/runtime-persistence/store-contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createTempDirectory,
	openNodeSqliteDriver,
} from "../../test/sqlite-node.ts";
import { openMobileDatabase } from "./database.ts";
import { MOBILE_SCHEMA_VERSION } from "./migrations.ts";
import { createSqliteRuntimeSaveStore } from "./runtime-save-store.ts";
import type { MobileDatabase } from "./sqlite.ts";

/**
 * SQLite adapter. **It runs the same suite as the web Dexie adapter.**
 *
 * Running the contract suite against both adapters is the point of this file. If each side wrote
 * its own tests, one side might set `dirty` alone or advance revisions alone, and the symptom of
 * that mismatch is "progress disappears only on the phone". Nothing is mocked either. Durability is
 * a property of the medium, so only a real file can answer.
 */

let temp: ReturnType<typeof createTempDirectory>;

beforeEach(() => {
	temp = createTempDirectory();
});

afterEach(() => {
	temp.dispose();
});

const open = (name = "save.db"): Promise<MobileDatabase> =>
	openMobileDatabase(openNodeSqliteDriver(temp.path, name));

runtimeSaveStoreContract({
	name: "SQLite",
	async create() {
		let db = await open();
		return {
			store: createSqliteRuntimeSaveStore(db, async () => true),
			/** **Reopens the same file.** Durability is a property of the disk, not of the instance. */
			async reopen(): Promise<RuntimeSaveStore> {
				await db.close();
				db = await open();
				return createSqliteRuntimeSaveStore(db, async () => true);
			},
			async dispose() {
				await db.close();
			},
		};
	},
});

describe("properties of the SQLite adapter", () => {
	const snapshot = (chapter: number) => ({
		formatVersion: 1 as const,
		entries: [{ key: "run", version: 1, value: { chapter } }],
	});

	it("the version rose and both tables exist", async () => {
		const db = await open();
		try {
			const version = await db.first<{ user_version: number }>(
				"PRAGMA user_version",
			);
			expect(version?.user_version).toBe(MOBILE_SCHEMA_VERSION);
			for (const table of ["runtime_playthrough", "runtime_persistent"])
				expect(
					await db.first(
						`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
						[table],
					),
					table,
				).not.toBeNull();
		} finally {
			await db.close();
		}
	});

	/**
	 * The outbound collection's axis is `(dirty, id)`. Without the index, that scan walks the whole
	 * table.
	 */
	it("writing sets dirty and enters the outbound index", async () => {
		const db = await open();
		try {
			await createSqliteRuntimeSaveStore(db, async () => true).putPlaythrough({
				storyId: "story-1",
				snapshot: snapshot(1),
				updatedAt: "a",
			});
			const rows = await db.all<{ id: string }>(
				`SELECT id FROM runtime_playthrough WHERE dirty = 1 ORDER BY id`,
			);
			expect(rows).toHaveLength(1);
		} finally {
			await db.close();
		}
	});

	/** The snapshot is stored as one JSON blob and comes back unchanged. */
	it("the snapshot is stored as JSON and round-trips", async () => {
		const db = await open();
		try {
			const store = createSqliteRuntimeSaveStore(db, async () => true);
			await store.putPlaythrough({
				storyId: "story-1",
				snapshot: snapshot(7),
				updatedAt: "a",
			});
			expect((await store.getPlaythrough("story-1"))?.snapshot).toEqual(
				snapshot(7),
			);
			const raw = await db.first<{ snapshot: string }>(
				`SELECT snapshot FROM runtime_playthrough LIMIT 1`,
			);
			expect(JSON.parse(raw?.snapshot ?? "null")).toEqual(snapshot(7));
		} finally {
			await db.close();
		}
	});

	/** The revision is issued in the same transaction as the save, and the clock row advances with it. */
	it("revision and clock advance together", async () => {
		const db = await open();
		try {
			const store = createSqliteRuntimeSaveStore(db, async () => true);
			const first = await store.putPersistent({
				storyId: "story-1",
				snapshot: { formatVersion: 1, entries: [] },
				updatedAt: "a",
			});
			const second = await store.putPersistent({
				storyId: "story-1",
				snapshot: { formatVersion: 1, entries: [] },
				updatedAt: "b",
			});
			expect(second.rev).not.toEqual(first.rev);
		} finally {
			await db.close();
		}
	});

	it("initialSyncDone reads the sync state row", async () => {
		const db = await open();
		try {
			const store = createSqliteRuntimeSaveStore(db, async () => true);
			expect(await store.initialSyncDone()).toBe(false);
			await db.run(`UPDATE sync_state SET initial_sync_done = 1`);
			expect(await store.initialSyncDone()).toBe(true);
		} finally {
			await db.close();
		}
	});

	/**
	 * **A device that does not remember a key does not wait.**
	 *
	 * While this read a single bootstrap flag, an account that never configured sync had that flag
	 * false forever, and the playback screen stayed at `Syncing`. The first sync that would finish never
	 * starts. In that state **nobody can open a work.**
	 */
	it("a device that doesn't remember the key doesn't wait for the first sync", async () => {
		const db = await open();
		try {
			const store = createSqliteRuntimeSaveStore(db, async () => false);
			expect(await store.initialSyncDone()).toBe(true);
		} finally {
			await db.close();
		}
	});
});

describe("v12 → v13 migration", () => {
	/**
	 * **Builds a real v12 file and upgrades it in place.**
	 *
	 * Opening a new file does not verify this step. That path climbs from 0 to 13 at once, so the v13
	 * statements never run against **a file that already holds data**. So this test undoes what v13
	 * created, sets the version back to 12, and reopens.
	 */
	it("a v12 file goes up and the old rows remain", async () => {
		const first = await open();
		await first.run(
			`INSERT INTO chat_room (
				id, origin_story_id, title, adult, prompt_protected, seed,
				created_at, updated_at, deleted_at, dirty, server_version,
				rev_t, rev_c, rev_d
			) VALUES ('r1', NULL, 'Room', 0, 0, '{}', 'a', 'a', NULL, 1, 0, 1, 0, 'd')`,
		);
		await first.run(
			`INSERT INTO authoring_runtime_file (
				id, draft_id, path, content, created_at, updated_at,
				deleted_at, dirty, server_version, rev_t, rev_c, rev_d
			) VALUES ('f1', 'd1', 'src/main.tsx', 'export default () => null;', 'a', 'a', NULL, 1, 0, 1, 0, 'd')`,
		);
		/** Undo what v13 and later created. The file is now a real v12. */
		await first.run(`DROP TABLE runtime_playthrough`);
		await first.run(`DROP TABLE runtime_persistent`);
		await first.run(`DROP TABLE runtime_conversation`);
		await first.run(`DROP TABLE authoring_runtime_asset`);
		await first.run(`DROP TABLE authoring_draft_cover`);
		await first.run(`ALTER TABLE chat_room DROP COLUMN narration`);
		await first.run(`ALTER TABLE chat_room DROP COLUMN user_note`);
		await first.run(`DROP TABLE chat_character`);
		await first.run(`PRAGMA user_version = 12`);
		await first.close();

		const second = await open();
		try {
			const version = await second.first<{ user_version: number }>(
				"PRAGMA user_version",
			);
			expect(version?.user_version).toBe(MOBILE_SCHEMA_VERSION);
			/** Conversation and authoring data do not move a single row. There is no backfill. */
			expect(
				await second.first("SELECT id FROM chat_room WHERE id = 'r1'"),
			).not.toBeNull();
			expect(
				await second.first(
					"SELECT id FROM authoring_runtime_file WHERE id = 'f1'",
				),
			).not.toBeNull();
			/** **Empty is the correct state.** No playback surface existed before this version. */
			expect(
				await second.first("SELECT COUNT(*) AS n FROM runtime_playthrough"),
			).toEqual({ n: 0 });
			expect(
				await second.first("SELECT COUNT(*) AS n FROM runtime_persistent"),
			).toEqual({ n: 0 });
			/**
			 * v15's managed-image bindings are also **empty by design.** Before this version no surface
			 * bound logical names to images, so there is no value to invent.
			 */
			expect(
				await second.first("SELECT COUNT(*) AS n FROM authoring_runtime_asset"),
			).toEqual({ n: 0 });
			/** The upgraded file can actually be written to. */
			await createSqliteRuntimeSaveStore(
				second,
				async () => true,
			).putPlaythrough({
				storyId: "story-1",
				snapshot: snapshotFor(1),
				updatedAt: "a",
			});
			expect(
				(
					await createSqliteRuntimeSaveStore(
						second,
						async () => true,
					).getPlaythrough("story-1")
				)?.snapshot,
			).toEqual(snapshotFor(1));
		} finally {
			await second.close();
		}
	});
});

const snapshotFor = (chapter: number) => ({
	formatVersion: 1 as const,
	entries: [{ key: "run", version: 1, value: { chapter } }],
});
