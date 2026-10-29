import type { RuntimeConversationStore } from "@rowcat/runtime-persistence";
import { runtimeConversationIdFor } from "@rowcat/runtime-persistence";
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
 * Checks whether library rows actually pass through this mobile sync store: collection, application
 * and account isolation.
 *
 * Even if the codec and the table are each correct, missing the join point between them
 * (`TABLE_ORDER` and `tableOf`) means the record matches neither collection nor application. That
 * omission raises no error. The symptom is only that a work opened on the web never arrives in this
 * device's library.
 */

let temp: ReturnType<typeof createTempDirectory>;
let controller: LocalScopeController;
let library: RuntimeConversationStore;
let sync: SyncStore;

beforeEach(async () => {
	temp = createTempDirectory();
	controller = createTestScopeController(
		temp.path,
		createMemorySecureStorage(),
	);
	const scope = await controller.activate("alice");
	library = scope.stores.runtimeConversation;
	sync = scope.stores.sync;
});

afterEach(async () => {
	await controller.release();
	temp.dispose();
});

describe("outbound", () => {
	it("library rows go into collection and the payload is display values only", async () => {
		await library.touch({ storyId: "story-1", title: "Story", now: "a" });
		const batch = await sync.collectOutbound({ limit: 50, all: false });
		const record = batch.records.find(
			(candidate) => candidate.type === "runtime.conversation",
		);
		expect(record?.id).toBe(runtimeConversationIdFor("story-1"));
		expect(Object.keys(record?.payload?.data as object).sort()).toEqual([
			"createdAt",
			"removedAt",
			"slot",
			"storyId",
			"title",
			"updatedAt",
		]);
	});

	/** Removing is not a tombstone. The record goes up as a live record, not as `deleted`. */
	it("a removed row goes up as state, not as a tombstone", async () => {
		await library.touch({ storyId: "story-1", title: "Story", now: "a" });
		await library.remove({ storyId: "story-1", now: "b" });
		const batch = await sync.collectOutbound({ limit: 50, all: false });
		const record = batch.records.find(
			(candidate) => candidate.type === "runtime.conversation",
		);
		expect(record?.deleted).toBe(false);
		expect((record?.payload?.data as { removedAt: string }).removedAt).toBe(
			"b",
		);
	});
});

describe("inbound", () => {
	it("a remote library row lands locally and stands in the list", async () => {
		const id = runtimeConversationIdFor("story-1");
		await sync.applyPull({
			cursor: 1,
			entries: [
				wireEntry({
					type: "runtime.conversation",
					version: 1,
					record: {
						id,
						storyId: "story-1",
						slot: "default",
						title: "A story opened on the web",
						createdAt: "2026-09-01T00:00:00.000Z",
						updatedAt: "2026-09-02T00:00:00.000Z",
						removedAt: null,
						deletedAt: null,
						dirty: 0,
						serverVersion: 0,
						rev: { t: 5, c: 0, d: "web" },
					},
				}),
			],
		});
		const record = await library.get("story-1");
		expect(record?.title).toBe("A story opened on the web");
		expect(record?.dirty).toBe(0);
		expect(record?.serverVersion).toBe(1);
		expect((await library.list()).map((r) => r.id)).toEqual([id]);
	});

	it("a remote removal takes the row out of the list, and the higher revision wins entirely", async () => {
		await library.touch({ storyId: "story-1", title: "Story", now: "a" });
		const local = await library.get("story-1");
		await sync.applyPull({
			cursor: 2,
			entries: [
				wireEntry({
					type: "runtime.conversation",
					version: 2,
					record: {
						...(local as NonNullable<typeof local>),
						removedAt: "b",
						rev: { t: (local?.rev.t ?? 0) + 10, c: 0, d: "web" },
					},
				}),
			],
		});
		expect(await library.list()).toEqual([]);
		expect((await library.get("story-1"))?.removedAt).toBe("b");
	});
});

describe("account isolation", () => {
	it("another member's scope sees nothing", async () => {
		await library.touch({
			storyId: "story-1",
			title: "Alice's story",
			now: "a",
		});
		await controller.release();

		const bob = await controller.activate("bob");
		expect(await bob.stores.runtimeConversation.get("story-1")).toBeNull();
		expect(await bob.stores.runtimeConversation.list()).toEqual([]);
		const batch = await bob.stores.sync.collectOutbound({
			limit: 50,
			all: true,
		});
		expect(
			batch.records.filter((record) => record.type === "runtime.conversation"),
		).toEqual([]);
	});
});
