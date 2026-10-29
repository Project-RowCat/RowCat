import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createTempDirectory,
	openNodeSqliteDriver,
} from "../../test/sqlite-node.ts";
import { openMobileDatabase } from "./database.ts";
import { MOBILE_SCHEMA_VERSION, migrate } from "./migrations.ts";
import { createMobileDatabase } from "./sqlite.ts";

/**
 * Local schema versions. **We do not survive on `CREATE TABLE IF NOT EXISTS` forever.**
 *
 * That shape looks like it works today, but it does nothing on the day a column is added. A version
 * number is what answers "how far has this file been migrated", and that answer is what lets the
 * next version be applied.
 */

let temp: ReturnType<typeof createTempDirectory>;

beforeEach(() => {
	temp = createTempDirectory();
});

afterEach(() => {
	temp.dispose();
});

const open = (name = "test.db") =>
	openMobileDatabase(openNodeSqliteDriver(temp.path, name));

describe("migrations", () => {
	it("a new file goes up to the current version", async () => {
		const db = await open();
		const row = await db.first<{ user_version: number }>("PRAGMA user_version");
		expect(row?.user_version).toBe(MOBILE_SCHEMA_VERSION);
		await db.close();
	});

	it("opening twice gives the same version and the data remains", async () => {
		const first = await open();
		await first.run(
			`INSERT INTO chat_room (
				id, origin_story_id, title, adult, prompt_protected, seed,
				created_at, updated_at, deleted_at, dirty, server_version,
				rev_t, rev_c, rev_d
			) VALUES ('r1', NULL, 'Room', 0, 0, '{}', 'a', 'a', NULL, 1, 0, 1, 0, 'd')`,
		);
		await first.close();

		const second = await open();
		const row = await second.first<{ user_version: number }>(
			"PRAGMA user_version",
		);
		expect(row?.user_version).toBe(MOBILE_SCHEMA_VERSION);
		expect(
			await second.first("SELECT id FROM chat_room WHERE id = 'r1'"),
		).not.toBeNull();
		await second.close();
	});

	it("v2 removes the character table and the old authoring columns", async () => {
		/**
		 * The folding itself (`foldLegacyDraftBody`) is pinned by the `@rowcat/authoring` tests. Here we
		 * check that **the migration actually ran to completion**. If the old columns remain, the mapping
		 * layer starts reading them again, and that is silent drift rather than an error.
		 */
		const db = await open();
		const tables = (
			await db.all<{ name: string }>(
				"SELECT name FROM sqlite_master WHERE type = 'table'",
			)
		).map((row) => row.name);
		expect(tables).not.toContain("authoring_character");

		const columns = (
			await db.all<{ name: string }>("PRAGMA table_info(authoring_draft)")
		).map((row) => row.name);
		expect(columns).toContain("prompt");
		for (const dropped of [
			"body_mode",
			"scenario",
			"play_guide",
			"suggested_persona",
		])
			expect(columns).not.toContain(dropped);
		await db.close();
	});

	it("v3 stands the device preference table, and that table has no sync axes", async () => {
		/**
		 * **The absence of columns is the point of this version.** If even one of `dirty`,
		 * `server_version`, `rev_*` or `deleted_at` is present, the table looks like a synced value and
		 * will eventually be written as one. Then a value chosen on a device with Anthropic connected
		 * arrives at a device without it, and becomes a **default that cannot be used**.
		 */
		const db = await open();
		const columns = (
			await db.all<{ name: string }>("PRAGMA table_info(generation_preference)")
		).map((row) => row.name);
		expect(columns.sort()).toEqual([
			"key",
			"reasoning_effort",
			"response_length",
			"target",
			"version",
		]);
		await db.close();
	});

	it("the six record tables and the state row table all exist", async () => {
		const db = await open();
		const rows = await db.all<{ name: string }>(
			"SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
		);
		const names = rows.map((row) => row.name);
		for (const table of [
			"authoring_draft",
			"authoring_lore",
			"authoring_scene",
			"chat_memory",
			"chat_message",
			"chat_room",
			"sync_state",
		])
			expect(names).toContain(table);
		await db.close();
	});

	it("v8 adds one automatic sync preference column, and that column has no sync axes", async () => {
		/**
		 * This is a column of `sync_state`, not a separate settings table (its scope matches that row:
		 * member plus device). `NULL` is the default and means on, so files created before this version
		 * are correct without a backfill. That it does not appear in the codecs or TABLE_ORDER is checked
		 * by value in `auto-sync-preference.test.ts`.
		 */
		const db = await open();
		const columns = (
			await db.all<{ name: string }>("PRAGMA table_info(sync_state)")
		).map((row) => row.name);
		expect(columns).toContain("auto_sync_on");

		const row = await db.first<{ auto_sync_on: number | null }>(
			"SELECT auto_sync_on FROM sync_state WHERE key = 'state'",
		);
		/** The row may not exist yet (new file), or exist with NULL; either way it reads as on. */
		expect(row?.auto_sync_on ?? null).toBeNull();
		await db.close();
	});

	it("every synced table has a dirty continuation-scan index", async () => {
		/**
		 * Without these, outbound collection becomes a full scan on every window. It shows up as
		 * **slowness**, not an error, so it first surfaces in an account that has accumulated a hundred
		 * thousand messages.
		 */
		const db = await open();
		const rows = await db.all<{ name: string; tbl_name: string }>(
			"SELECT name, tbl_name FROM sqlite_master WHERE type = 'index'",
		);
		for (const table of [
			"chat_room",
			"chat_message",
			"chat_memory",
			"authoring_draft",
			"authoring_lore",
			"authoring_scene",
		])
			expect(
				rows.some(
					(row) => row.tbl_name === table && row.name.endsWith("_dirty"),
				),
			).toBe(true);
		await db.close();
	});

	it("foreign keys aren't turned on — children arriving before parents is normal", async () => {
		const db = await open();
		const row = await db.first<{ foreign_keys: number }>("PRAGMA foreign_keys");
		expect(row?.foreign_keys).toBe(0);
		await db.close();
	});

	it("when a statement fails the version number doesn't rise", async () => {
		/**
		 * If the version number were raised first and the statements run afterwards, this failure would
		 * leave a file marked as migrated while the table is missing, and that file would never heal
		 * itself.
		 */
		const driver = openNodeSqliteDriver(temp.path, "broken.db", {
			beforeStatement: (sql) => {
				if (sql.includes("CREATE TABLE authoring_scene"))
					throw new Error("The disk died");
			},
		});
		const db = createMobileDatabase(driver);
		await expect(migrate(db)).rejects.toThrow();

		const row = await db.first<{ user_version: number }>("PRAGMA user_version");
		expect(row?.user_version).toBe(0);
		expect(
			await db.first("SELECT name FROM sqlite_master WHERE name = 'chat_room'"),
		).toBeNull();
		await db.close();
	});

	/**
	 * v16: managed assets are no longer only images.
	 *
	 * SQLite has no `DROP NOT NULL`, so the table is rebuilt. Two things are easy to lose silently in
	 * that procedure, so they are checked by value: the rows, and the **indexes** (they vanish with
	 * the table; if not recreated, list queries become full scans, and the only symptom is slowness).
	 */
	it("v16 backfills old asset rows as image and rebuilds the index", async () => {
		const db = await open();
		await db.run(
			`INSERT INTO authoring_runtime_asset (
				id, draft_id, path, kind, asset_id, mime, width, height, duration_ms,
				created_at, updated_at, deleted_at, dirty, server_version,
				rev_t, rev_c, rev_d
			) VALUES ('a1', 'd1', 'characters/sena/smile', 'image', 'media-A',
				'image/webp', 640, 480, NULL, 'a', 'a', NULL, 1, 0, 1, 0, 'd')`,
		);
		await db.run(
			`INSERT INTO authoring_runtime_asset (
				id, draft_id, path, kind, asset_id, mime, width, height, duration_ms,
				created_at, updated_at, deleted_at, dirty, server_version,
				rev_t, rev_c, rev_d
			) VALUES ('a2', 'd1', 'audio/bgm/main', 'audio', 'media-B',
				'audio/mpeg', NULL, NULL, 102000, 'a', 'a', NULL, 1, 0, 1, 0, 'd')`,
		);

		const columns = await db.all<{ name: string; notnull: number }>(
			"PRAGMA table_info(authoring_runtime_asset)",
		);
		const byName = new Map(columns.map((row) => [row.name, row.notnull]));
		expect(byName.get("kind")).toBe(1);
		/** Audio rows have no value for these two columns, so both must be relaxed. */
		expect(byName.get("width")).toBe(0);
		expect(byName.get("height")).toBe(0);
		expect(byName.has("duration_ms")).toBe(true);

		const indexes = (
			await db.all<{ name: string }>(
				"SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'authoring_runtime_asset'",
			)
		).map((row) => row.name);
		expect(indexes).toContain("authoring_runtime_asset_draft");
		expect(indexes).toContain("authoring_runtime_asset_dirty");

		expect(
			await db.first("SELECT id FROM authoring_runtime_asset WHERE id = 'a2'"),
		).not.toBeNull();
		await db.close();
	});
});
