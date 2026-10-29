import type { Rev } from "@rowcat/contracts/sync";
import { describe, expect, it } from "vitest";
import type {
	RuntimePersistentRecord,
	RuntimePlaythroughRecord,
} from "./model.ts";
import { runtimePersistentIdFor, runtimePlaythroughIdFor } from "./model.ts";
import {
	RUNTIME_PERSISTENCE_SYNC_SCHEMA_VERSION,
	runtimePersistenceSyncCodecs,
	runtimePersistentSyncCodec,
	runtimePlaythroughSyncCodec,
} from "./sync-codec.ts";

const rev = (t: number, c = 0, d = "device-a"): Rev => ({ t, c, d });

const playthrough = (
	overrides: Partial<RuntimePlaythroughRecord> = {},
): RuntimePlaythroughRecord => ({
	id: runtimePlaythroughIdFor("story-1"),
	storyId: "story-1",
	slot: "default",
	snapshot: {
		formatVersion: 1,
		entries: [{ key: "run", version: 1, value: { chapter: 5 } }],
	},
	updatedAt: "2026-09-01T00:00:00.000Z",
	deletedAt: null,
	dirty: 1,
	serverVersion: 0,
	rev: rev(10),
	...overrides,
});

const persistent = (
	overrides: Partial<RuntimePersistentRecord> = {},
): RuntimePersistentRecord => ({
	id: runtimePersistentIdFor("story-1"),
	storyId: "story-1",
	snapshot: {
		formatVersion: 1,
		entries: [{ key: "meta", version: 1, value: { endings: ["library"] } }],
	},
	updatedAt: "2026-09-01T00:00:00.000Z",
	deletedAt: null,
	dirty: 1,
	serverVersion: 0,
	rev: rev(10),
	...overrides,
});

describe("identity", () => {
	/**
	 * Identity must be deterministic so that two devices merge the same record. With random ids, both
	 * records would survive, and no one could tell which one holds this story's progress.
	 */
	it("derives from the story id, with different prefixes for the two lifetimes", () => {
		expect(runtimePlaythroughIdFor("s")).toBe("runtime-playthrough:s:default");
		expect(runtimePersistentIdFor("s")).toBe("runtime-persistent:s");
		expect(runtimePlaythroughIdFor("s")).not.toBe(runtimePersistentIdFor("s"));
	});

	/**
	 * The server primary key is (owner, id). Using the story id as-is would make these records contend
	 * for the same row as the story record.
	 */
	it("does not use the story id as is", () => {
		expect(runtimePlaythroughIdFor("s")).not.toBe("s");
		expect(runtimePersistentIdFor("s")).not.toBe("s");
	});
});

describe("codec", () => {
	it("three types sharing one version", () => {
		expect(runtimePersistenceSyncCodecs.map((codec) => codec.type)).toEqual([
			"runtime.playthrough",
			"runtime.persistent",
			"runtime.conversation",
		]);
		for (const codec of runtimePersistenceSyncCodecs)
			expect(codec.schemaVersion).toBe(RUNTIME_PERSISTENCE_SYNC_SCHEMA_VERSION);
	});

	it("playthroughs round-trip", () => {
		const record = playthrough();
		const decoded = runtimePlaythroughSyncCodec.decode({
			id: record.id,
			schemaVersion: RUNTIME_PERSISTENCE_SYNC_SCHEMA_VERSION,
			rev: record.rev,
			deletedAt: null,
			data: runtimePlaythroughSyncCodec.encode(record),
		});
		expect(decoded).toEqual({ ...record, dirty: 0, serverVersion: 0 });
	});

	it("persistent state round-trips", () => {
		const record = persistent();
		const decoded = runtimePersistentSyncCodec.decode({
			id: record.id,
			schemaVersion: RUNTIME_PERSISTENCE_SYNC_SCHEMA_VERSION,
			rev: record.rev,
			deletedAt: null,
			data: runtimePersistentSyncCodec.encode(record),
		});
		expect(decoded).toEqual({ ...record, dirty: 0, serverVersion: 0 });
	});

	/**
	 * If the payload carried member, device, or sync axes, those values would eventually be read as
	 * authorization.
	 */
	it("payloads carry no identity or sync axes", () => {
		expect(
			Object.keys(
				runtimePlaythroughSyncCodec.encode(playthrough()) as object,
			).sort(),
		).toEqual(["slot", "snapshot", "storyId", "updatedAt"]);
		expect(
			Object.keys(
				runtimePersistentSyncCodec.encode(persistent()) as object,
			).sort(),
		).toEqual(["snapshot", "storyId", "updatedAt"]);
	});

	/**
	 * A successful decryption does not make the JSON trustworthy. Malformed creator state must never
	 * reach QuickJS.
	 */
	it("refuses payloads off the shape", () => {
		const base = {
			id: "x",
			schemaVersion: RUNTIME_PERSISTENCE_SYNC_SCHEMA_VERSION,
			rev: rev(1),
			deletedAt: null,
		};
		for (const data of [
			null,
			{},
			{ storyId: "", slot: "default", snapshot: {}, updatedAt: "" },
			{ storyId: "s", slot: "quick", snapshot: {}, updatedAt: "" },
			{
				storyId: "s",
				slot: "default",
				snapshot: { formatVersion: 2, entries: [] },
				updatedAt: "",
			},
			{
				storyId: "s",
				slot: "default",
				snapshot: { formatVersion: 1, entries: [{ key: "9", version: 1 }] },
				updatedAt: "",
			},
		])
			expect(
				runtimePlaythroughSyncCodec.decode({ ...base, data }),
				JSON.stringify(data),
			).toBeNull();
	});
});

describe("merge: whole-record HLC LWW", () => {
	it("the higher revision wins wholesale", () => {
		const local = playthrough({ rev: rev(5) });
		const remote = playthrough({
			rev: rev(9),
			snapshot: {
				formatVersion: 1,
				entries: [{ key: "run", version: 1, value: { chapter: 7 } }],
			},
		});
		const merged = runtimePlaythroughSyncCodec.merge(local, remote);
		expect(merged.remoteWins).toBe(true);
		expect(merged.record.snapshot).toEqual(remote.snapshot);
	});

	/**
	 * No deep merge, and this test locks that in. Merging per key would produce a state nobody wrote.
	 * In arrays, an item that never existed could appear, or one that did could vanish.
	 */
	it("does not mix per entry", () => {
		const local = playthrough({
			rev: rev(5),
			snapshot: {
				formatVersion: 1,
				entries: [
					{ key: "run", version: 1, value: { chapter: 5 } },
					{ key: "bag", version: 1, value: { items: ["sword"] } },
				],
			},
		});
		const remote = playthrough({
			rev: rev(9),
			snapshot: {
				formatVersion: 1,
				entries: [{ key: "run", version: 1, value: { chapter: 7 } }],
			},
		});
		const merged = runtimePlaythroughSyncCodec.merge(local, remote);
		expect(merged.record.snapshot.entries).toHaveLength(1);
	});

	it("the local stays when it is newer", () => {
		const local = persistent({ rev: rev(9) });
		const remote = persistent({ rev: rev(5) });
		const merged = runtimePersistentSyncCodec.merge(local, remote);
		expect(merged.remoteWins).toBe(false);
		expect(merged.record).toBe(local);
	});

	/**
	 * Even when the remote wins, dirty and serverVersion carry over from local. Unpushed local changes
	 * must survive the merge.
	 */
	it("even when the remote wins, it inherits the local dirty and serverVersion", () => {
		const local = playthrough({ rev: rev(1), dirty: 1, serverVersion: 4 });
		const remote = playthrough({ rev: rev(2), dirty: 0, serverVersion: 0 });
		const merged = runtimePlaythroughSyncCodec.merge(local, remote);
		expect(merged.record.dirty).toBe(1);
		expect(merged.record.serverVersion).toBe(4);
	});

	/** Reset is a newer state, not a tombstone. The empty snapshot beats the old progress. */
	it("an empty snapshot at a higher revision beats old progress", () => {
		const local = playthrough({ rev: rev(3) });
		const reset = playthrough({
			rev: rev(4),
			snapshot: { formatVersion: 1, entries: [] },
		});
		const merged = runtimePlaythroughSyncCodec.merge(local, reset);
		expect(merged.remoteWins).toBe(true);
		expect(merged.record.snapshot.entries).toEqual([]);
	});

	/** A corrupt local row (NaN or negative) must not make the comparison non-total. */
	it("folds NaN and negative revisions before comparing", () => {
		const local = playthrough({ rev: { t: Number.NaN, c: -1, d: "a" } });
		const remote = playthrough({ rev: { t: 1, c: 0, d: "b" } });
		expect(runtimePlaythroughSyncCodec.merge(local, remote).remoteWins).toBe(
			true,
		);
		expect(runtimePlaythroughSyncCodec.merge(remote, local).remoteWins).toBe(
			false,
		);
	});
});
