import { StoryChatSeedDto } from "@rowcat/contracts/chat";
import Dexie from "dexie";
import { afterEach, describe, expect, it } from "vitest";
import { createChatStore } from "#/lib/local-chat/store.ts";
import { activateLocalDbScope, resetLocalDbScope } from "./db.ts";

/**
 * Migration test, v6 to v7: the migration only adds the memory table.
 *
 * There is no upgrade function, so there seems to be nothing to verify. What matters is the data on
 * the user's device. If the new declaration omits an existing stores() line, Dexie deletes that
 * table. No review or type check catches a missing line, and the only symptom is a user's
 * conversations vanishing after deploy. So the test writes real v6 rows and opens them through
 * product code.
 */

let sequence = 0;
const nextViewer = (label: string): string => `${label}-v7-${++sequence}`;
const dbName = (viewerId: string): string => `rowcat_chat_${viewerId}`;

afterEach(() => {
	resetLocalDbScope();
});

/**
 * Schema snapshot of the database as it was before memories existed. The declaration matches v6 in
 * db.ts.
 */
class LegacyV6Db extends Dexie {
	constructor(name: string) {
		super(name);
		this.version(6).stores({
			rooms: "id, updatedAt, originStoryId, [dirty+id]",
			messages: "id, roomId, [roomId+createdAt+id], [dirty+id]",
			storyDrafts: "id, updatedAt, publishedStoryId, [dirty+id]",
			draftCharacters: "id, draftId, [draftId+position], [dirty+id]",
			draftLoreEntries: "id, draftId, [draftId+positionIndex], [dirty+id]",
			draftStartScenes: "id, draftId, [draftId+position], [dirty+id]",
			syncState: "key",
			generationPreferences: "key",
			providerConnections: "provider",
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

describe("v6 → v7 migration", () => {
	it("existing rows all stay and the memory table is created empty", async () => {
		const viewer = nextViewer("alice");
		const legacy = new LegacyV6Db(dbName(viewer));
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
			dirty: 1,
			serverVersion: 0,
			rev: REV,
		});
		await legacy.table("messages").put({
			id: "msg-1",
			roomId: "room-1",
			role: "user",
			speaker: "",
			content: "Message before migration",
			createdAt: "2026-01-02T00:00:00.000Z",
			updatedAt: "2026-01-02T00:00:00.000Z",
			deletedAt: null,
			dirty: 1,
			serverVersion: 0,
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

		const db = activateLocalDbScope(viewer);
		const store = createChatStore(db);

		const room = await store.getRoom("room-1");
		expect(room?.title).toBe("Conversation before migration");
		expect(await store.listRecentMessages("room-1")).toHaveLength(1);
		// The sync cursor and clock also survive. The migration must not rewind sync state.
		expect((await db.syncState.get("local"))?.cursor).toBe(12);

		expect(await db.chatMemories.count()).toBe(0);
		expect(await store.listMemories("room-1")).toHaveLength(0);

		const created = await store.createMemory({
			roomId: "room-1",
			content: "Memory written after migration",
		});
		expect(created.dirty).toBe(1);
		expect(await store.listMemories("room-1")).toHaveLength(1);
	});
});
