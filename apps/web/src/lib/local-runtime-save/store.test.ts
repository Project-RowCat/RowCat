import type { RuntimeSaveStore } from "@rowcat/runtime-persistence";
import { runtimeSaveStoreContract } from "@rowcat/runtime-persistence/store-contract";
import { describe, expect, it } from "vitest";
import { LocalDb } from "#/lib/local-data/db.ts";
import { createDexieRuntimeSaveStore } from "./store.ts";

/**
 * Dexie adapter for the save store. It passes the same suite as the mobile SQLite adapter. Both
 * adapters run one contract suite because separate tests let one side set dirty, or advance the
 * revision, differently. The symptom would be "progress disappears only on the phone".
 */

let counter = 0;

/**
 * A remembered key, shape only. This test asks whether a key exists, not what it opens. A real
 * CryptoKey would make this file a WebCrypto consumer, a coupling that has nothing to do with the
 * adapter's behavior.
 */
const REMEMBERED_KEY = {
	wrapKey: {} as CryptoKey,
	iv: new Uint8Array(12),
	ct: new Uint8Array(1),
};

runtimeSaveStoreContract({
	name: "Dexie",
	async create() {
		counter += 1;
		const name = `runtime_save_contract_${counter}`;
		let db = new LocalDb(name);
		await db.open();
		return {
			store: createDexieRuntimeSaveStore(db),
			/** Reopens the database. Durability is a property of IndexedDB, not of the instance. */
			async reopen(): Promise<RuntimeSaveStore> {
				db.close();
				db = new LocalDb(name);
				await db.open();
				return createDexieRuntimeSaveStore(db);
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

	/** The scope being one database per member is the entirety of account isolation. */
	it("nothing is visible in another member's database", async () => {
		const alice = await open("runtime_save_alice");
		const bob = await open("runtime_save_bob");
		try {
			await createDexieRuntimeSaveStore(alice).putPlaythrough({
				storyId: "story-1",
				snapshot: {
					formatVersion: 1,
					entries: [{ key: "run", version: 1, value: { chapter: 4 } }],
				},
				updatedAt: "a",
			});
			expect(
				await createDexieRuntimeSaveStore(bob).getPlaythrough("story-1"),
			).toBeNull();
			expect(await bob.runtimePlaythroughs.count()).toBe(0);
		} finally {
			alice.close();
			bob.close();
			await LocalDb.delete("runtime_save_alice");
			await LocalDb.delete("runtime_save_bob");
		}
	});

	/**
	 * The outbound collection key is `[dirty+id]`. Without that index, the scan would walk the entire
	 * table.
	 */
	it("writing sets dirty and enters the outbound index", async () => {
		const db = await open("runtime_save_dirty");
		try {
			await createDexieRuntimeSaveStore(db).putPersistent({
				storyId: "story-1",
				snapshot: { formatVersion: 1, entries: [] },
				updatedAt: "a",
			});
			const dirty = await db.runtimePersistentStates
				.where("[dirty+id]")
				.between([1, ""], [1, []], false, true)
				.toArray();
			expect(dirty).toHaveLength(1);
		} finally {
			db.close();
			await LocalDb.delete("runtime_save_dirty");
		}
	});

	/**
	 * The revision is issued in the same transaction as the save, and the clock row advances with it.
	 * If the two split, the next write could issue the same revision again, and the two versions would
	 * be indistinguishable.
	 */
	it("revision and clock advance together", async () => {
		const db = await open("runtime_save_hlc");
		try {
			const store = createDexieRuntimeSaveStore(db);
			const first = await store.putPlaythrough({
				storyId: "story-1",
				snapshot: { formatVersion: 1, entries: [] },
				updatedAt: "a",
			});
			const second = await store.putPlaythrough({
				storyId: "story-1",
				snapshot: { formatVersion: 1, entries: [] },
				updatedAt: "b",
			});
			expect(second.rev).not.toEqual(first.rev);
			const state = await db.syncState.toArray();
			expect(state[0]?.hlcT).toBeGreaterThan(0);
		} finally {
			db.close();
			await LocalDb.delete("runtime_save_hlc");
		}
	});

	/**
	 * Whether the first sync has happened is answered by the sync state row, not by counting records.
	 */
	it("initialSyncDone reads the sync state row", async () => {
		const db = await open("runtime_save_initial");
		try {
			const store = createDexieRuntimeSaveStore(db);
			const rows = await db.syncState.toArray();
			/**
			 * Only a device that remembers the key narrows this question to the bootstrap flag. Without a
			 * key, nothing can be received, so the wait itself does not apply (see the property below).
			 */
			await db.syncState.put({
				...rows[0],
				deviceKey: REMEMBERED_KEY,
			});
			expect(await store.initialSyncDone()).toBe(false);
			await db.syncState.put({
				...rows[0],
				deviceKey: REMEMBERED_KEY,
				initialSyncDone: true,
			});
			expect(await store.initialSyncDone()).toBe(true);
		} finally {
			db.close();
			await LocalDb.delete("runtime_save_initial");
		}
	});

	/**
	 * A device without the key does not wait. Earlier, the screen read only the bootstrap flag. An
	 * account that never set up sync kept that flag false forever, so the play screen stayed on `Syncing`
	 * indefinitely, because no first sync would ever finish. In that state no one could
	 * open a work. The browser journey test caught this first.
	 */
	it("a device that remembers no keys does not wait for the first sync", async () => {
		const db = await open("runtime_save_nokey");
		try {
			const store = createDexieRuntimeSaveStore(db);
			expect((await db.syncState.toArray())[0]?.deviceKey ?? null).toBeNull();
			expect(await store.initialSyncDone()).toBe(true);
		} finally {
			db.close();
			await LocalDb.delete("runtime_save_nokey");
		}
	});
});
