import { StoryChatSeedDto } from "@rowcat/contracts/chat";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { createChatStore } from "#/lib/local-chat/store.ts";
import { activateLocalDbScope, resetLocalDbScope } from "./db.ts";

/**
 * Migration test, v12 to v13: backfill of the memory source, plus the summary table.
 *
 * What matters here is again the user's device data. Memories written before the source axis
 * existed were all written by people. If that is not recorded, their source is undefined. An
 * undefined value reads as false in isAutoMemory, so it looks safe today. But each place that
 * sorts, encodes or rewinds would then need its own fallback. Miss one, and a memory the user wrote
 * becomes eligible for automatic cleanup.
 *
 * The test also checks that dirty is not raised. Raising it would make every memory in the account
 * a push target right after migration, although that round trip changes no bytes.
 */

let sequence = 0;
const nextViewer = (label: string): string => `${label}-v13-${++sequence}`;
const dbName = (viewerId: string): string => `rowcat_chat_${viewerId}`;

afterEach(() => {
	resetLocalDbScope();
});

/**
 * The legacy schema is copied by hand on purpose. Importing the product declaration would make this
 * test change along with that file, and the "data written by the old version" premise would
 * silently disappear.
 */
class LegacyV12Db extends Dexie {
	constructor(name: string) {
		super(name);
		this.version(12).stores({
			rooms: "id, updatedAt, originStoryId, [dirty+id]",
			messages: "id, roomId, [roomId+createdAt+id], [dirty+id]",
			chatMemories: "id, roomId, [dirty+id]",
			storyDrafts: "id, updatedAt, publishedStoryId, [dirty+id]",
			draftLoreEntries: "id, draftId, [draftId+positionIndex], [dirty+id]",
			draftStartScenes: "id, draftId, [draftId+position], [dirty+id]",
			draftSceneImages: "id, draftId, [draftId+position], [dirty+id]",
			syncState: "key",
			generationPreferences: "key",
			providerConnections: "provider",
			draftCovers: "draftId",
		});
	}
}

const SEED = StoryChatSeedDto.parse({
	version: 1,
	storyId: "story-1",
	title: "Story before migration",
	adult: false,
	promptProtected: false,
});

const REV = { t: 1_767_225_600_000, c: 5, d: "old-device" };

async function seedLegacy(viewer: string): Promise<void> {
	const legacy = new LegacyV12Db(dbName(viewer));
	await legacy.open();
	await legacy.table("rooms").put({
		id: "room-1",
		originStoryId: "story-1",
		title: "Conversation before migration",
		adult: false,
		promptProtected: false,
		seed: SEED,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-02T00:00:00.000Z",
		deletedAt: null,
		dirty: 0,
		serverVersion: 3,
		rev: REV,
	});
	await legacy.table("chatMemories").put({
		id: "mem-clean",
		roomId: "room-1",
		content: "Memory written before migration",
		pinned: false,
		createdAt: "2026-01-02T00:00:00.000Z",
		updatedAt: "2026-01-02T00:00:00.000Z",
		deletedAt: null,
		dirty: 0,
		serverVersion: 2,
		rev: REV,
	});
	/** Already-deleted memory. It must not come back, but its source is still backfilled. */
	await legacy.table("chatMemories").put({
		id: "mem-gone",
		roomId: "room-1",
		content: "Memory deleted before migration",
		pinned: true,
		createdAt: "2026-01-02T00:00:00.000Z",
		updatedAt: "2026-01-03T00:00:00.000Z",
		deletedAt: "2026-01-03T00:00:00.000Z",
		dirty: 1,
		serverVersion: 2,
		rev: REV,
	});
	await legacy.table("syncState").put({
		key: "local",
		deviceId: "old-device",
		hlcT: REV.t,
		hlcC: REV.c,
		cursor: 12,
		protocolEpoch: 1,
		initialSyncDone: true,
		lastSyncedAt: null,
		lastError: null,
	});
	legacy.close();
}

describe("v12 → v13 migration", () => {
	it("memories from before migration all become person-written", async () => {
		const viewer = nextViewer("alice");
		await seedLegacy(viewer);

		const db = activateLocalDbScope(viewer);
		const store = createChatStore(db);

		const memories = await store.listMemories("room-1");
		expect(memories).toHaveLength(1);
		expect(memories[0].source).toBe("user");
		/**
		 * A memory written by a person has no source conversation, so there is nothing for originAt to
		 * point to.
		 */
		expect(memories[0].originAt).toBeNull();

		// The tombstone is backfilled as well, so the reading code never encounters undefined.
		const tombstone = await db.chatMemories.get("mem-gone");
		expect(tombstone?.source).toBe("user");
		expect(tombstone?.deletedAt).toBe("2026-01-03T00:00:00.000Z");
	});

	/**
	 * The point of this test is that the migration only records a fact that was already true. The
	 * codec does not put "user" into the payload, so ciphertext produced after the backfill is
	 * byte-identical to the earlier output. There is nothing to push.
	 */
	it("does not dirty clean memories", async () => {
		const viewer = nextViewer("alice");
		await seedLegacy(viewer);

		const db = activateLocalDbScope(viewer);
		const clean = await db.chatMemories.get("mem-clean");
		expect(clean?.dirty).toBe(0);
		expect(clean?.serverVersion).toBe(2);
		expect(clean?.rev).toEqual(REV);
	});

	it("conversations and the sync cursor stay", async () => {
		const viewer = nextViewer("alice");
		await seedLegacy(viewer);

		const db = activateLocalDbScope(viewer);
		const store = createChatStore(db);
		expect((await store.getRoom("room-1"))?.title).toBe(
			"Conversation before migration",
		);
		expect((await db.syncState.get("local"))?.cursor).toBe(12);
	});

	it("the summary table exists and is empty", async () => {
		const viewer = nextViewer("alice");
		await seedLegacy(viewer);

		const db = activateLocalDbScope(viewer);
		const store = createChatStore(db);
		expect(await db.chatSummaries.count()).toBe(0);
		/** A missing summary is the exact state here: maintenance has not run yet. */
		expect(await store.getSummary("room-1")).toBeNull();
	});

	it("auto memories made after migration stay auto", async () => {
		const viewer = nextViewer("alice");
		await seedLegacy(viewer);

		const store = createChatStore(activateLocalDbScope(viewer));
		await store.applyMemoryMaintenance({
			roomId: "room-1",
			summary: "Summary after migration",
			through: { createdAt: "2026-02-01T00:00:00.000Z", messageId: "m-1" },
			operations: [{ type: "add", content: "Automatically extracted fact" }],
			expect: { epoch: 0, frontier: null },
		});

		const memories = await store.listMemories("room-1");
		const bySource = Object.fromEntries(
			memories.map((memory) => [memory.content, memory.source]),
		);
		expect(bySource).toEqual({
			"Memory written before migration": "user",
			"Automatically extracted fact": "auto",
		});
	});
});
