import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseDraftConflictRecovery } from "@rowcat/authoring";
import { afterEach, describe, expect, it } from "vitest";
import { LocalDb } from "#/lib/local-data/db.ts";
import { createDraftRecoveryStore } from "#/lib/local-recovery/store.ts";
import {
	buildEntries,
	converge,
	createDevice,
	type Device,
	FakeSyncServer,
	TEST_DEK,
} from "#/test/sync-devices.ts";
import { syncCodecRegistry } from "./registry.ts";

/**
 * Local recovery for concurrent edits to the same group, checked over a two-device round trip.
 *
 * What is verified is not whether a copy gets created, but two things: the canonical value still
 * converges exactly as before, and the lost value remains on this device. If the first breaks, this
 * slice changed the merge algorithm. If the second breaks, it did nothing.
 */

let devices: Device[] = [];
const spawn = (server: FakeSyncServer, name: string): Device => {
	const device = createDevice(name, server);
	devices.push(device);
	return device;
};

afterEach(() => {
	for (const device of devices) device.close();
	devices = [];
});

const recoveriesOf = async (device: Device) =>
	createDraftRecoveryStore(device.db).list();

/**
 * Advances A's logical clock, to fix the winner. If two devices edit in the same millisecond of one
 * process's wall clock, the winner would be decided by the random device id and the test would
 * flake. What matters here is whether the loser remains, not who wins, so the axis is pinned
 * (roundtrip.test.ts does the same for the same reason).
 */
async function advanceClock(device: Device, ms: number): Promise<void> {
	const clock = await device.db.syncState.get("state");
	if (clock) await device.db.syncState.put({ ...clock, hlcT: clock.hlcT + ms });
}

/**
 * A loses the split: A's edit has not been pushed yet when B's newer version arrives. The order is
 * hand-built on purpose. Running converge twice would let the first pusher go clean (dirty = 0), so
 * the next pull would end as a silent overwrite rather than a merge. That is not the event this
 * slice handles. At that point the signal is the protocol's sync_stale_inbound, and the domain
 * codec is never called. The split edits must actually pass through the merge.
 */
async function localLoses(a: Device, b: Device): Promise<{ draftId: string }> {
	const draft = await a.authoring.createDraft({ prompt: "Original" });
	await converge(a, b);
	await a.authoring.updateDraft(draft.id, { prompt: "A's prompt" });
	await advanceClock(b, 2000);
	await b.authoring.updateDraft(draft.id, { prompt: "B's prompt" });
	await b.engine.run(TEST_DEK);
	return { draftId: draft.id };
}

/**
 * A wins the split, yet the remote record is newer. B edits the prompt first (a lower group
 * revision), then edits the title and pushes (a higher record revision). A's pull therefore goes
 * through the merge, where the prompt group is won by local. The value that disappears is the
 * remote's. This direction needs a copy too, so whichever device is opened, the lost value can be
 * found.
 */
async function localWins(a: Device, b: Device): Promise<{ draftId: string }> {
	const draft = await a.authoring.createDraft({
		prompt: "Original",
		title: "Original",
	});
	await converge(a, b);
	await b.authoring.updateDraft(draft.id, { prompt: "B's prompt" });
	await advanceClock(a, 2000);
	await a.authoring.updateDraft(draft.id, { prompt: "A's prompt" });
	await advanceClock(b, 5000);
	await b.authoring.updateDraft(draft.id, { title: "B's title" });
	await b.engine.run(TEST_DEK);
	return { draftId: draft.id };
}

describe("what is kept", () => {
	it("concurrent edits to the same group **keep the loser's value** and the canonical one converges", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const { draftId } = await localLoses(a, b);
		await a.engine.run(TEST_DEK);
		await b.engine.run(TEST_DEK);

		// The canonical value still converges to one answer, exactly as before.
		const fromA = (await a.authoring.getDraft(draftId))?.prompt;
		const fromB = (await b.authoring.getDraft(draftId))?.prompt;
		expect(fromA).toBe(fromB);
		expect(fromA).toBe("B's prompt");

		// And the loser's value stays on this device.
		const preserved = await recoveriesOf(a);
		expect(preserved).toHaveLength(1);
		expect(preserved[0]).toMatchObject({
			draftId,
			group: "body",
			values: { prompt: "A's prompt" },
		});
		// The winning device lost nothing, so it has no copy.
		expect(await recoveriesOf(b)).toEqual([]);
	});

	it("the disappearing value is kept even when **local wins**", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const { draftId } = await localWins(a, b);
		await a.engine.run(TEST_DEK);

		const merged = await a.authoring.getDraft(draftId);
		// The prompt stays local and the title is taken from remote: the usual group merge.
		expect(merged?.prompt).toBe("A's prompt");
		expect(merged?.title).toBe("B's title");

		const preserved = await recoveriesOf(a);
		expect(preserved).toHaveLength(1);
		expect(preserved[0]).toMatchObject({
			group: "body",
			values: { prompt: "B's prompt" },
		});
	});

	it("concurrent edits to **different groups** make no copy", async () => {
		/**
		 * Both edits survive the merge, so no value is lost. A copy created here would tell the user
		 * about an edit they never lost, and the copy would hold the old value they had already updated.
		 * Restoring it would lose the newest value.
		 */
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const draft = await a.authoring.createDraft({
			title: "Original",
			prompt: "Original",
		});
		await converge(a, b);

		await a.authoring.updateDraft(draft.id, {
			title: "Title edited on the phone",
		});
		await b.authoring.updateDraft(draft.id, {
			prompt: "Prompt written on the laptop",
		});
		await converge(a, b);
		await converge(a, b);

		for (const device of [a, b]) {
			const merged = await device.authoring.getDraft(draft.id);
			expect(merged?.title).toBe("Title edited on the phone");
			expect(merged?.prompt).toBe("Prompt written on the laptop");
			expect(await recoveriesOf(device)).toEqual([]);
		}
	});

	it("the kept value holds **only that group's fields**", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		await localLoses(a, b);
		await a.engine.run(TEST_DEK);

		const preserved = await recoveriesOf(a);
		expect(preserved).toHaveLength(1);
		expect(Object.keys(preserved[0].values)).toEqual(["prompt"]);
		for (const key of ["rev", "fieldRev", "dirty", "serverVersion", "id"])
			expect(preserved[0].values).not.toHaveProperty(key);
	});
});

describe("deduplication", () => {
	it("applying the same page twice leaves one copy", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		await localLoses(a, b);

		/**
		 * Feeds the same page twice, bypassing the engine. This is what pull retries, reconnects, and
		 * re-application actually produce. If a copy were added each time, the user would get the same
		 * notice several times.
		 */
		const page = server.pull(0, 50);
		const entries = await buildEntries(a, page);
		const first = await a.sync.applyPull({ entries, cursor: page.cursor });
		const second = await a.sync.applyPull({ entries, cursor: page.cursor });

		expect(first.recovered).toBe(1);
		// The second application must not create a new copy. It is a re-observation of the same loss.
		expect(second.recovered).toBe(0);
		expect(await recoveriesOf(a)).toHaveLength(1);
	});

	it("reopening the database keeps the copy without adding more", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		await localLoses(a, b);
		await a.engine.run(TEST_DEK);

		const before = await recoveriesOf(a);
		expect(before).toHaveLength(1);

		const name = a.db.name;
		a.db.close();
		const reopened = new LocalDb(name);
		try {
			const after = await createDraftRecoveryStore(reopened).list();
			expect(after).toEqual(before);
		} finally {
			reopened.close();
		}
	});
});

describe("atomicity", () => {
	it("if the merge result does not commit, no copy remains", async () => {
		/**
		 * The one dangerous state: the canonical value is overwritten, but the loser's copy does not
		 * exist. The opposite (only the copy survives) is harmless, and it does not happen anyway,
		 * because both happen in one transaction.
		 */
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const { draftId } = await localLoses(a, b);

		const cursorBefore = (await a.sync.readState()).cursor;
		const page = server.pull(0, 50);
		const entries = await buildEntries(a, page);
		/** Finally, inserts an entry whose merge itself throws. */
		const exploding = {
			...entries[0],
			merge: () => {
				throw new Error("the disk died");
			},
		} as (typeof entries)[number];

		await expect(
			a.sync.applyPull({
				entries: [...entries, exploding],
				cursor: page.cursor,
			}),
		).rejects.toThrow();

		// Nothing was applied: neither the canonical value, the copy, nor the cursor.
		expect((await a.authoring.getDraft(draftId))?.prompt).toBe("A's prompt");
		expect(await recoveriesOf(a)).toEqual([]);
		expect((await a.sync.readState()).cursor).toBe(cursorBefore);
	});
});

describe("the copy stays even if the draft is gone", () => {
	it("the cascade does not take a remotely deleted draft's copy", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const { draftId } = await localLoses(a, b);
		await a.engine.run(TEST_DEK);
		expect(await recoveriesOf(a)).toHaveLength(1);

		await b.engine.run(TEST_DEK);
		await b.authoring.deleteDraft(draftId);
		await converge(a, b);
		await converge(a, b);

		expect(await a.authoring.getDraft(draftId)).toBeNull();
		/**
		 * A lost paragraph of a manuscript deleted on another device may be here. If it were deleted
		 * together with the manuscript, the user would never know it existed.
		 */
		expect(await recoveriesOf(a)).toHaveLength(1);
	});
});

describe("protocol boundary", () => {
	it("a recovery copy **is not a sync record**", () => {
		/**
		 * A copy that is synced becomes a second conflict domain: the thing created to resolve conflicts
		 * would create conflicts. The absence is confirmed both in the vocabulary and at the assembly
		 * point.
		 */
		expect(syncCodecRegistry.get("sync.recovery")).toBeNull();
		expect(syncCodecRegistry.types()).toEqual([
			"chat.room",
			"chat.message",
			"chat.memory",
			"chat.summary",
			"chat.persona",
			/**
			 * Excluded even though it is a child of a room. The reasoning is in the codec list comment of
			 * @rowcat/chat.
			 */
			"chat.character",
			"authoring.draft",
			"authoring.lore",
			"authoring.scene",
			"authoring.sceneImage",
			"authoring.runtimeProject",
			"authoring.runtimeFile",
			"authoring.runtimeAsset",
			"runtime.playthrough",
			"runtime.persistent",
			"runtime.conversation",
		]);
	});

	it("outbound collection does not pick up copies", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		await localLoses(a, b);
		await a.engine.run(TEST_DEK);
		expect(await recoveriesOf(a)).toHaveLength(1);

		/**
		 * all: true ignores dirty and scans every record. If a copy could reach the wire by any path,
		 * this would catch it.
		 */
		const batch = await a.sync.collectOutbound({ limit: 200, all: true });
		for (const record of batch.records)
			expect(record.type).not.toContain("recovery");
	});

	it("diagnostic events carry no copy content", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const { draftId } = await localLoses(a, b);
		await a.engine.run(TEST_DEK);

		/**
		 * Diagnostics carry only counts and categories (SyncDiagnosticEvent). Plaintext here would flow
		 * straight into consoles, telemetry, and error reporters. That is why recovery has its own
		 * channel.
		 */
		const serialized = JSON.stringify([...a.diagnostics, ...b.diagnostics]);
		expect(serialized).not.toContain("A's prompt");
		expect(serialized).not.toContain("B's prompt");
		expect(serialized).not.toContain(draftId);
	});

	it("no server route or record type was added", () => {
		/**
		 * Confirms in the transport layer's source that this slice never touched the server. The first
		 * endpoint that carries copies would break this line first.
		 */
		const transport = readFileSync(
			fileURLToPath(new URL("./transport.ts", import.meta.url)),
			"utf8",
		);
		expect(transport).not.toMatch(/recover/i);
	});
});

describe("account isolation", () => {
	it("copies live only in that member's database", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		await localLoses(a, b);
		await a.engine.run(TEST_DEK);
		expect(await recoveriesOf(a)).toHaveLength(1);

		/**
		 * Each member's scope is a separate database (rowcat_chat_<viewerId>). If copies lived outside
		 * the member scope (localStorage or global state), a user who switches accounts would see the
		 * previous user's manuscript. The absence is checked here by value.
		 */
		const other = new LocalDb(`${a.db.name}_other_member`);
		try {
			expect(await createDraftRecoveryStore(other).list()).toEqual([]);
		} finally {
			other.close();
		}
	});
});

describe("lenient reads", () => {
	it("an unreadable row does not block the whole list", async () => {
		const db = new LocalDb("recovery_lenient_read");
		try {
			await db.syncRecoveries.bulkPut([
				{
					id: "broken",
					type: "authoring.draft",
					recordId: "draft-1",
					scope: "body",
					losingRev: { t: 1, c: 0, d: "device-a" },
					payload: "garbage",
					observedAt: "2026-02-01T00:00:00.000Z",
				},
				{
					id: "good",
					type: "authoring.draft",
					recordId: "draft-1",
					scope: "body",
					losingRev: { t: 2, c: 0, d: "device-a" },
					payload: {
						draftId: "draft-1",
						group: "body",
						values: { prompt: "Live copy" },
					},
					observedAt: "2026-02-02T00:00:00.000Z",
				},
			]);
			const store = createDraftRecoveryStore(db);
			const items = await store.listForDraft("draft-1");
			expect(items).toHaveLength(1);
			expect(items[0].values.prompt).toBe("Live copy");
			expect(parseDraftConflictRecovery).toBeTypeOf("function");
		} finally {
			db.close();
		}
	});
});
