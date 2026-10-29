import type { Rev } from "@rowcat/contracts/sync";
import { compareRev } from "@rowcat/sync";
import { afterEach, describe, expect, it } from "vitest";
import { activateLocalDbScope, LocalDb, resetLocalDbScope } from "./db.ts";
import { nextRev, nextRevs, readSyncState } from "./hlc.ts";

/**
 * Tests for the revision-issuing adapter. They cover persistence and transaction boundaries, not
 * the algorithm, which @rowcat/sync verifies since tick is pure.
 *
 * Checked here: the clock state is stored, one request yields distinct revisions, and two
 * connections to the same database never issue the same revision twice.
 */

let sequence = 0;
const nextViewer = (label: string): string => `${label}-${++sequence}`;
const dbName = (viewerId: string): string => `rowcat_chat_${viewerId}`;

const key = (rev: Rev): string => `${rev.t}:${rev.c}:${rev.d}`;

afterEach(() => {
	resetLocalDbScope();
});

describe("issuing", () => {
	it("as many distinct revisions as requested come out ascending", async () => {
		const db = activateLocalDbScope(nextViewer("alice"));

		const revs = await db.transaction("rw", db.syncState, () =>
			nextRevs(db, 3),
		);

		expect(revs).toHaveLength(3);
		expect(new Set(revs.map(key)).size).toBe(3);
		expect(compareRev(revs[1], revs[0])).toBeGreaterThan(0);
		expect(compareRev(revs[2], revs[1])).toBeGreaterThan(0);
	});

	it("the issued clock state is saved in the same transaction", async () => {
		/**
		 * If the state is not stored, a refreshed tab reissues revisions it already issued. Once two
		 * records share a revision, the merge can never determine their order.
		 */
		const db = activateLocalDbScope(nextViewer("alice"));

		const [issued] = await db.transaction("rw", db.syncState, () =>
			nextRevs(db, 1),
		);
		const state = await readSyncState(db);

		expect(state?.hlcT).toBe(issued.t);
		expect(state?.hlcC).toBe(issued.c);
		expect(issued.d).toBe(state?.deviceId);
	});

	it("the clock continues after closing and reopening the connection", async () => {
		const alice = nextViewer("alice");
		const first = await nextRev(activateLocalDbScope(alice));
		resetLocalDbScope();

		const second = await nextRev(activateLocalDbScope(alice));

		expect(compareRev(second, first)).toBeGreaterThan(0);
		expect(second.d).toBe(first.d);
	});

	it("leaving syncState out of the transaction fails on the spot", async () => {
		/**
		 * Silent divergence is the safety net. If a caller forgets to include the clock table in its
		 * transaction, Dexie rejects the write. That makes "record saved but clock not advanced"
		 * impossible to create.
		 */
		const db = activateLocalDbScope(nextViewer("alice"));

		await expect(
			db.transaction("rw", db.rooms, () => nextRev(db)),
		).rejects.toThrow();
	});
});

describe("two connections to the same database", () => {
	it("overlapping writes never issue the same revision twice", async () => {
		/**
		 * Two tabs open the same member. The device id is the same, so `d` does not tell them apart.
		 * Uniqueness comes only from the persisted clock plus IndexedDB transaction serialization. A
		 * module-global clock would issue duplicate values across these two connections.
		 *
		 * Limit: fake-indexeddb only approximates browser locking. Passing here does not prove that every
		 * browser race is covered, but if the "stored row is the clock's source of truth" premise breaks,
		 * this test shows it immediately.
		 */
		const alice = nextViewer("tabs");
		const name = dbName(alice);
		const tabA = new LocalDb(name);
		const tabB = new LocalDb(name);
		try {
			const batches = await Promise.all([
				tabA.transaction("rw", tabA.syncState, () => nextRevs(tabA, 5)),
				tabB.transaction("rw", tabB.syncState, () => nextRevs(tabB, 5)),
				tabA.transaction("rw", tabA.syncState, () => nextRevs(tabA, 5)),
				tabB.transaction("rw", tabB.syncState, () => nextRevs(tabB, 5)),
			]);
			const all = batches.flat();

			expect(all).toHaveLength(20);
			expect(new Set(all.map(key)).size).toBe(20);
			expect(new Set(all.map((rev) => rev.d)).size).toBe(1);
		} finally {
			tabA.close();
			tabB.close();
		}
	});
});
