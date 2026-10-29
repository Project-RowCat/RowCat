import { authoringSyncCodecs } from "@rowcat/authoring";
import type { AnySyncCodec, InboundEntry, SyncRecordShape } from "@rowcat/sync";
import { createCodecRegistry } from "@rowcat/sync";
import { describe, expect, test } from "vitest";
import { createRecordStore } from "./records.ts";

/**
 * The record store's contract: commit unit and atomicity. This checks protocol semantics, not the
 * domain: what gets collected, when `dirty` clears, and that a pulled page applies whole or not at
 * all. If any of the three slips, the symptom is not an error but a vanished manuscript.
 */

const TYPES = new Set([
	"authoring.draft",
	"authoring.runtimeProject",
	"authoring.runtimeFile",
	"authoring.runtimeAsset",
]);

const registry = createCodecRegistry(
	authoringSyncCodecs.filter((codec) =>
		TYPES.has(codec.type),
	) as readonly AnySyncCodec[],
);

const FILE = "authoring.runtimeFile";

let clock = 1_000;
const store = () =>
	createRecordStore({
		deviceId: "device-a",
		registry,
		now: () => (clock += 1),
		nowIso: () => new Date(clock).toISOString(),
	});

const file = (id: string, content: string): SyncRecordShape =>
	({
		id,
		draftId: "draft-1",
		path: "src/main.tsx",
		content,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		deletedAt: null,
		dirty: 1,
		serverVersion: 0,
		rev: { t: 1, c: 0, d: "remote" },
	}) as unknown as SyncRecordShape;

const record = (
	id: string,
	content: string,
	version: number,
	rev = { t: 5, c: 0, d: "remote" },
): InboundEntry => ({
	kind: "record",
	id,
	type: FILE,
	version,
	serverUpdatedAt: "2026-01-02T00:00:00.000Z",
	rev,
	remote: { ...file(id, content), rev, dirty: 0, serverVersion: 0 },
	merge: (local) => ({ record: local, remoteWins: true }),
});

describe("outbound collection", () => {
	test("only dirty goes out", async () => {
		const local = store();
		local.put(FILE, file("a", "a"));
		await local.applyPull({
			entries: [record("b", "b", 1)],
			cursor: 1,
		});
		const batch = await local.collectOutbound({ limit: 10 });
		expect(batch.records.map((row) => row.id)).toEqual(["a"]);
	});

	test("all scans everything", async () => {
		const local = store();
		local.put(FILE, file("a", "a"));
		await local.applyPull({ entries: [record("b", "b", 1)], cursor: 1 });
		const batch = await local.collectOutbound({ limit: 10, all: true });
		expect(batch.records.map((row) => row.id).sort()).toEqual(["a", "b"]);
	});

	test("tombstones have no payload", async () => {
		const local = store();
		local.put(FILE, file("a", "a"));
		local.remove(FILE, "a");
		const batch = await local.collectOutbound({ limit: 10 });
		expect(batch.records[0]).toMatchObject({ deleted: true, payload: null });
	});

	test("past the window it gives the next cursor", async () => {
		const local = store();
		local.put(FILE, file("a", "a"));
		local.put(FILE, file("b", "b"));
		const batch = await local.collectOutbound({ limit: 1 });
		expect(batch.records).toHaveLength(1);
		expect(batch.next).toEqual({ type: FILE, id: "b" });
	});
});

describe("applying push results", () => {
	test("dirty clears only when the revision is still the one collected", async () => {
		const local = store();
		local.put(FILE, file("a", "a"));
		const collected = await local.collectOutbound({ limit: 10 });
		const sent = collected.records[0];
		expect(sent).toBeDefined();

		// The same file is edited again while the push is in flight.
		local.put(FILE, {
			...file("a", "b"),
			updatedAt: "2026-01-03T00:00:00.000Z",
		});
		await local.commitPush([
			{
				id: "a",
				type: FILE,
				version: 3,
				rev: sent?.rev ?? { t: 0, c: 0, d: "" },
			},
		]);

		const again = await local.collectOutbound({ limit: 10 });
		expect(again.records.map((row) => row.id)).toEqual(["a"]);
		expect(again.records[0]?.baseVersion).toBe(3);
	});

	test("clears when unchanged", async () => {
		const local = store();
		local.put(FILE, file("a", "a"));
		const collected = await local.collectOutbound({ limit: 10 });
		await local.commitPush([
			{
				id: "a",
				type: FILE,
				version: 1,
				rev: collected.records[0]?.rev ?? { t: 0, c: 0, d: "" },
			},
		]);
		expect((await local.collectOutbound({ limit: 10 })).records).toEqual([]);
		expect(local.hasPending()).toBe(false);
	});
});

describe("applying pulls", () => {
	test("records seen for the first time come in clean", async () => {
		const local = store();
		const result = await local.applyPull({
			entries: [record("a", "a", 2)],
			cursor: 7,
		});
		expect(result.applied).toBe(1);
		expect(local.get(FILE, "a")).toMatchObject({ dirty: 0, serverVersion: 2 });
		expect((await local.readState()).cursor).toBe(7);
	});

	test("an older version does not roll back; it uploads again", async () => {
		const local = store();
		local.put(FILE, file("a", "new value"));
		const result = await local.applyPull({
			entries: [record("a", "old value", 4, { t: 1, c: 0, d: "remote" })],
			cursor: 2,
		});
		expect(result.conflicts).toBe(1);
		expect(
			(local.get(FILE, "a") as unknown as { content: string } | null)?.content,
		).toBe("new value");
		expect((await local.collectOutbound({ limit: 10 })).records).toHaveLength(
			1,
		);
	});

	test("unknown types are ignored and only the cursor advances", async () => {
		const local = store();
		const result = await local.applyPull({
			entries: [{ kind: "ignored", reason: "unknown_type" }],
			cursor: 12,
		});
		expect(result).toMatchObject({ applied: 0, ignored: 1 });
		expect((await local.readState()).cursor).toBe(12);
	});

	test("a draft tombstone deletes runtime children too", async () => {
		const local = store();
		await local.applyPull({ entries: [record("f1", "a", 1)], cursor: 1 });
		await local.applyPull({
			entries: [
				{
					kind: "tombstone",
					id: "draft-1",
					type: "authoring.draft",
					version: 2,
					serverUpdatedAt: "2026-02-01T00:00:00.000Z",
				},
			],
			cursor: 2,
		});
		expect(local.get(FILE, "f1")).toBeNull();
		// The cascade does not raise `dirty`; one deletion must not become a push of every child.
		expect((await local.collectOutbound({ limit: 10 })).records).toEqual([]);
	});

	test("nothing remains when a page throws midway", async () => {
		const local = store();
		const exploding: InboundEntry = {
			...record("boom", "a", 1),
			get remote(): SyncRecordShape {
				throw new Error("failed during apply");
			},
		} as InboundEntry;
		await expect(
			local.applyPull({
				entries: [record("ok", "a", 1), exploding],
				cursor: 9,
			}),
		).rejects.toThrow();
		expect(local.get(FILE, "ok")).toBeNull();
		expect((await local.readState()).cursor).toBe(0);
	});
});

describe("preparing a full resync", () => {
	test("rewinds the cursor without deleting local data", async () => {
		const local = store();
		await local.applyPull({ entries: [record("a", "a", 1)], cursor: 5 });
		await local.resetCursor();
		const state = await local.readState();
		expect(state.cursor).toBe(0);
		expect(state.initialSyncDone).toBe(false);
		expect(local.get(FILE, "a")).not.toBeNull();
	});

	test("everything uploads again when the server says it doesn't know", async () => {
		const local = store();
		await local.applyPull({ entries: [record("a", "a", 3)], cursor: 5 });
		await local.forgetServerVersions();
		const batch = await local.collectOutbound({ limit: 10 });
		expect(batch.records).toHaveLength(1);
		expect(batch.records[0]?.baseVersion).toBe(0);
	});
});
