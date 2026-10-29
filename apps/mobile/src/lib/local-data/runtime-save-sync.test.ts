import type { RuntimeSaveStore } from "@rowcat/runtime-persistence";
import { runtimePlaythroughIdFor } from "@rowcat/runtime-persistence";
import type { SyncStore } from "@rowcat/sync";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { wireEntry } from "../../test/inbound.ts";
import {
	createMemorySecureStorage,
	createTempDirectory,
	createTestScopeController,
} from "../../test/sqlite-node.ts";
import type { LocalScopeController } from "./activation.ts";

/**
 * Checks that player saves actually pass through mobile's sync store. If the codec and table are
 * each correct but the link between them (`TABLE_ORDER`, `tableOf`) is missing, the record is
 * neither collected nor applied, and nothing reports it: progress made on web simply never reaches
 * this device.
 */

let temp: ReturnType<typeof createTempDirectory>;
let controller: LocalScopeController;
let runtimeSave: RuntimeSaveStore;
let sync: SyncStore;

const snapshot = (chapter: number) => ({
	formatVersion: 1 as const,
	entries: [{ key: "run", version: 1, value: { chapter } }],
});

beforeEach(async () => {
	temp = createTempDirectory();
	controller = createTestScopeController(
		temp.path,
		createMemorySecureStorage(),
	);
	const scope = await controller.activate("alice");
	runtimeSave = scope.stores.runtimeSave;
	sync = scope.stores.sync;
});

afterEach(async () => {
	await controller.release();
	temp.dispose();
});

describe("outbound", () => {
	it("save records go into collection", async () => {
		await runtimeSave.putPlaythrough({
			storyId: "story-1",
			snapshot: snapshot(3),
			updatedAt: "a",
		});
		await runtimeSave.putPersistent({
			storyId: "story-1",
			snapshot: { formatVersion: 1, entries: [] },
			updatedAt: "a",
		});
		const batch = await sync.collectOutbound({ limit: 50, all: false });
		expect(
			batch.records
				.map((record) => record.type)
				.filter((type) => type.startsWith("runtime."))
				.sort(),
		).toEqual(["runtime.persistent", "runtime.playthrough"]);
	});

	// The encoded payload carries no identity or sync axis.
	it("the payload is only the snapshot and story id", async () => {
		await runtimeSave.putPlaythrough({
			storyId: "story-1",
			snapshot: snapshot(3),
			updatedAt: "a",
		});
		const batch = await sync.collectOutbound({ limit: 50, all: false });
		const record = batch.records.find(
			(candidate) => candidate.type === "runtime.playthrough",
		);
		expect(Object.keys(record?.payload?.data as object).sort()).toEqual([
			"slot",
			"snapshot",
			"storyId",
			"updatedAt",
		]);
	});
});

describe("inbound", () => {
	it("a remote save lands locally", async () => {
		const id = runtimePlaythroughIdFor("story-1");
		await sync.applyPull({
			cursor: 1,
			entries: [
				wireEntry({
					type: "runtime.playthrough",
					version: 1,
					record: {
						id,
						storyId: "story-1",
						slot: "default",
						snapshot: snapshot(9),
						updatedAt: "2026-09-01T00:00:00.000Z",
						deletedAt: null,
						dirty: 0,
						serverVersion: 0,
						rev: { t: 5, c: 0, d: "web" },
					},
				}),
			],
		});
		const record = await runtimeSave.getPlaythrough("story-1");
		expect(record?.snapshot).toEqual(snapshot(9));
		expect(record?.dirty).toBe(0);
		expect(record?.serverVersion).toBe(1);
	});

	// The higher revision wins as a whole record; entries are not merged.
	it("conflicts are whole-record LWW", async () => {
		await runtimeSave.putPlaythrough({
			storyId: "story-1",
			snapshot: snapshot(2),
			updatedAt: "a",
		});
		const local = await runtimeSave.getPlaythrough("story-1");
		await sync.applyPull({
			cursor: 2,
			entries: [
				wireEntry({
					type: "runtime.playthrough",
					version: 2,
					record: {
						...(local as NonNullable<typeof local>),
						snapshot: snapshot(11),
						rev: { t: (local?.rev.t ?? 0) + 10, c: 0, d: "web" },
					},
				}),
			],
		});
		expect((await runtimeSave.getPlaythrough("story-1"))?.snapshot).toEqual(
			snapshot(11),
		);
	});
});

describe("account isolation", () => {
	/**
	 * Isolation comes entirely from each scope being one per-member database. Alice's progress must
	 * appear in neither Bob's store nor Bob's outbound batch.
	 */
	it("another member's scope sees nothing", async () => {
		await runtimeSave.putPlaythrough({
			storyId: "story-1",
			snapshot: snapshot(4),
			updatedAt: "a",
		});
		await controller.release();

		const bob = await controller.activate("bob");
		expect(await bob.stores.runtimeSave.getPlaythrough("story-1")).toBeNull();
		const batch = await bob.stores.sync.collectOutbound({
			limit: 50,
			all: true,
		});
		expect(
			batch.records.filter((record) => record.type.startsWith("runtime.")),
		).toEqual([]);
	});
});
