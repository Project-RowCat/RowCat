import type { RuntimeConversationStore } from "@rowcat/runtime-persistence";
import { runtimeConversationStoreContract } from "@rowcat/runtime-persistence/store-contract";
import { describe, expect, it } from "vitest";
import { LocalDb } from "#/lib/local-data/db.ts";
import { createDexieRuntimeConversationStore } from "./conversation-store.ts";
import { createDexieRuntimeSaveStore } from "./store.ts";

/**
 * Dexie adapter for library rows. It passes the same suite as the mobile SQLite adapter. On top of
 * that, it must hold two facts: account isolation (one database per member is the entire
 * isolation), and library writes never touch the save-state table, so removing an item does not
 * affect progress.
 */

let counter = 0;

runtimeConversationStoreContract({
	name: "Dexie",
	async create() {
		counter += 1;
		const name = `runtime_conversation_contract_${counter}`;
		let db = new LocalDb(name);
		await db.open();
		return {
			store: createDexieRuntimeConversationStore(db),
			async reopen(): Promise<RuntimeConversationStore> {
				db.close();
				db = new LocalDb(name);
				await db.open();
				return createDexieRuntimeConversationStore(db);
			},
			async dispose() {
				db.close();
				await LocalDb.delete(name);
			},
		};
	},
});

describe("Dexie adapter properties", () => {
	const open = async (name: string): Promise<LocalDb> => {
		const db = new LocalDb(name);
		await db.open();
		return db;
	};

	it("nothing is visible in another member's database", async () => {
		const alice = await open("runtime_conversation_alice");
		const bob = await open("runtime_conversation_bob");
		try {
			await createDexieRuntimeConversationStore(alice).touch({
				storyId: "story-1",
				title: "Alice's story",
				now: "a",
			});
			const bobStore = createDexieRuntimeConversationStore(bob);
			expect(await bobStore.get("story-1")).toBeNull();
			expect(await bobStore.list()).toEqual([]);
			expect(await bob.runtimeConversations.count()).toBe(0);
		} finally {
			alice.close();
			bob.close();
			await LocalDb.delete("runtime_conversation_alice");
			await LocalDb.delete("runtime_conversation_bob");
		}
	});

	/**
	 * Removing does not reach progress, and progress survives reopening. Library rows and save state
	 * are separate tables behind separate ports. This check locks in that separation: however often
	 * remove and touch are called, the rows of both tables stay byte-identical.
	 */
	it("removing and reopening change the save state not one character", async () => {
		const db = await open("runtime_conversation_progress");
		try {
			const save = createDexieRuntimeSaveStore(db);
			const library = createDexieRuntimeConversationStore(db);
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
			const playthroughBefore = await db.runtimePlaythroughs.toArray();
			const persistentBefore = await db.runtimePersistentStates.toArray();

			await library.touch({ storyId: "story-1", title: "Story", now: "t1" });
			await library.remove({ storyId: "story-1", now: "t2" });
			await library.touch({ storyId: "story-1", title: null, now: "t3" });

			expect(await db.runtimePlaythroughs.toArray()).toEqual(playthroughBefore);
			expect(await db.runtimePersistentStates.toArray()).toEqual(
				persistentBefore,
			);
			expect((await save.getPlaythrough("story-1"))?.snapshot.entries).toEqual([
				{ key: "run", version: 1, value: { chapter: 7 } },
			]);
		} finally {
			db.close();
			await LocalDb.delete("runtime_conversation_progress");
		}
	});

	/**
	 * Library rows do not require a save row. A runtime with no save state still appears in the
	 * library.
	 */
	it("a row stands even without a save row", async () => {
		const db = await open("runtime_conversation_stateless");
		try {
			const library = createDexieRuntimeConversationStore(db);
			await library.touch({
				storyId: "story-1",
				title: "Stateless story",
				now: "t",
			});
			expect(await db.runtimePlaythroughs.count()).toBe(0);
			expect(await db.runtimePersistentStates.count()).toBe(0);
			expect((await library.list()).map((r) => r.title)).toEqual([
				"Stateless story",
			]);
		} finally {
			db.close();
			await LocalDb.delete("runtime_conversation_stateless");
		}
	});
});
