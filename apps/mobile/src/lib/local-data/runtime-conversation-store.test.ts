import type { RuntimeConversationStore } from "@rowcat/runtime-persistence";
import { runtimeConversationStoreContract } from "@rowcat/runtime-persistence/store-contract";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createTempDirectory,
	openNodeSqliteDriver,
} from "../../test/sqlite-node.ts";
import { openMobileDatabase } from "./database.ts";
import { MOBILE_SCHEMA_VERSION } from "./migrations.ts";
import { createSqliteRuntimeConversationStore } from "./runtime-conversation-store.ts";
import { createSqliteRuntimeSaveStore } from "./runtime-save-store.ts";
import type { MobileDatabase } from "./sqlite.ts";

/**
 * SQLite adapter for library rows. **It runs the same suite as the web Dexie adapter.**
 *
 * On top of that, it checks what this adapter must actually keep. Writes to library rows never
 * touch the save-state tables (removing a row does not erase progress). And a row appears in the
 * library even with no save row (a runtime that never writes save state still appears in the
 * library).
 */

let temp: ReturnType<typeof createTempDirectory>;

beforeEach(() => {
	temp = createTempDirectory();
});

afterEach(() => {
	temp.dispose();
});

const open = (name = "conversation.db"): Promise<MobileDatabase> =>
	openMobileDatabase(openNodeSqliteDriver(temp.path, name));

runtimeConversationStoreContract({
	name: "SQLite",
	async create() {
		let db = await open();
		return {
			store: createSqliteRuntimeConversationStore(db),
			async reopen(): Promise<RuntimeConversationStore> {
				await db.close();
				db = await open();
				return createSqliteRuntimeConversationStore(db);
			},
			async dispose() {
				await db.close();
			},
		};
	},
});

describe("properties of the SQLite adapter", () => {
	it("the version rose and the table exists", async () => {
		const db = await open();
		/**
		 * The schema version is pinned as a value because a table's existence must move with the version.
		 * Any commit that changes this line is a commit that adds a migration, and that fact shows up in
		 * review.
		 */
		expect(MOBILE_SCHEMA_VERSION).toBe(20);
		const table = await db.first<{ name: string }>(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'runtime_conversation'",
		);
		expect(table?.name).toBe("runtime_conversation");
		await db.close();
	});

	it("removing and reopening don't change the save state by a character", async () => {
		const db = await open();
		const save = createSqliteRuntimeSaveStore(db, async () => true);
		const library = createSqliteRuntimeConversationStore(db);
		await save.putPlaythrough({
			storyId: "story-1",
			snapshot: {
				formatVersion: 1,
				entries: [{ key: "run", version: 1, value: { chapter: 7 } }],
			},
			updatedAt: "t0",
		});
		await save.putPersistent({
			storyId: "story-1",
			snapshot: {
				formatVersion: 1,
				entries: [{ key: "meta", version: 1, value: { endings: ["a"] } }],
			},
			updatedAt: "t0",
		});
		const before = {
			playthrough: await db.all("SELECT * FROM runtime_playthrough", []),
			persistent: await db.all("SELECT * FROM runtime_persistent", []),
		};

		await library.touch({ storyId: "story-1", title: "Story", now: "t1" });
		await library.remove({ storyId: "story-1", now: "t2" });
		await library.touch({ storyId: "story-1", title: null, now: "t3" });

		expect(await db.all("SELECT * FROM runtime_playthrough", [])).toEqual(
			before.playthrough,
		);
		expect(await db.all("SELECT * FROM runtime_persistent", [])).toEqual(
			before.persistent,
		);
		expect((await save.getPlaythrough("story-1"))?.snapshot.entries).toEqual([
			{ key: "run", version: 1, value: { chapter: 7 } },
		]);
		await db.close();
	});

	it("the row stands even without a save row", async () => {
		const db = await open();
		const library = createSqliteRuntimeConversationStore(db);
		await library.touch({ storyId: "s", title: "A stateless story", now: "t" });
		expect(
			await db.first<{ n: number }>(
				"SELECT COUNT(*) AS n FROM runtime_playthrough",
			),
		).toEqual({ n: 0 });
		expect((await library.list()).map((r) => r.title)).toEqual([
			"A stateless story",
		]);
		await db.close();
	});
});
