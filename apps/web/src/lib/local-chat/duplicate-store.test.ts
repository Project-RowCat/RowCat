import type { ChatStore } from "@rowcat/chat";
import {
	ChatRoomTitleError,
	createSummaryRecord,
	summaryIdFor,
} from "@rowcat/chat";
import { StoryChatSeedDto } from "@rowcat/contracts/chat";
import { afterEach, describe, expect, it } from "vitest";
import {
	activateLocalDbScope,
	type LocalDb,
	resetLocalDbScope,
} from "#/lib/local-data/db.ts";
import { nextRev } from "#/lib/local-data/hlc.ts";
import { createChatStore } from "./store.ts";

/**
 * Duplicating a room on real IndexedDB. What a copy carries is pinned in `@rowcat/chat`
 * (`room-duplicate.test.ts`); this file pins that the Dexie store reads every child table and writes
 * the copy without touching the original.
 */

let sequence = 0;
const nextViewer = (label: string): string => `${label}-${++sequence}`;

const seed = () =>
	StoryChatSeedDto.parse({
		version: 1,
		storyId: "story-1",
		title: "Test story",
		adult: false,
		promptProtected: false,
	});

afterEach(() => {
	resetLocalDbScope();
});

const filled = async (db: LocalDb, store: ChatStore) => {
	const room = await store.createRoom({
		originStoryId: "story-1",
		seed: seed(),
	});
	const first = await store.appendMessage({
		roomId: room.id,
		role: "user",
		content: "Open the door",
	});
	const second = await store.appendMessage({
		roomId: room.id,
		role: "assistant",
		content: "The door creaks open.",
	});
	await store.setRoomUserNote(room.id, "Keep it short");
	await store.createMemory({ roomId: room.id, content: "Has the key" });
	await store.createCharacter({ roomId: room.id, name: "Librarian" });
	await db.chatSummaries.put(
		createSummaryRecord(
			{
				roomId: room.id,
				summary: "They entered.",
				frontier: { createdAt: first.createdAt, messageId: first.id },
			},
			{ now: second.createdAt, rev: await nextRev(db) },
		),
	);
	return { room, first, second };
};

describe("duplicating a room", () => {
	it("copies messages, memories, characters, summary and settings into a new room", async () => {
		const db = activateLocalDbScope(nextViewer("alice"));
		const store = createChatStore(db);
		const { room } = await filled(db, store);

		const copy = await store.duplicateRoom(room.id, "Test story (copy)");
		if (!copy) throw new Error("expected a copy");

		expect(copy.id).not.toBe(room.id);
		expect(copy.title).toBe("Test story (copy)");
		expect(copy.userNote).toBe("Keep it short");
		expect(copy.routingSessionId).not.toBe(room.routingSessionId);
		expect(await store.getRoom(copy.id)).toEqual(copy);

		expect(
			(await store.listRecentMessages(copy.id)).map((m) => m.content),
		).toEqual(["Open the door", "The door creaks open."]);
		expect((await store.listMemories(copy.id)).map((m) => m.content)).toEqual([
			"Has the key",
		]);
		expect((await store.listCharacters(copy.id)).map((c) => c.name)).toEqual([
			"Librarian",
		]);

		const copiedFirst = (await store.listRecentMessages(copy.id))[0];
		expect(await store.getSummary(copy.id)).toMatchObject({
			id: summaryIdFor(copy.id),
			summary: "They entered.",
			frontier: { messageId: copiedFirst?.id },
		});

		/* The copy sorts first: it is the thing just made. */
		expect((await store.listRooms())[0]?.id).toBe(copy.id);
	});

	it("leaves the original untouched", async () => {
		const db = activateLocalDbScope(nextViewer("alice"));
		const store = createChatStore(db);
		const { room } = await filled(db, store);
		const before = {
			room: await db.rooms.get(room.id),
			messages: await db.messages.where("roomId").equals(room.id).toArray(),
			memories: await db.chatMemories.where("roomId").equals(room.id).toArray(),
		};

		await store.duplicateRoom(room.id, "copy");

		expect(await db.rooms.get(room.id)).toEqual(before.room);
		expect(await db.messages.where("roomId").equals(room.id).toArray()).toEqual(
			before.messages,
		);
		expect(
			await db.chatMemories.where("roomId").equals(room.id).toArray(),
		).toEqual(before.memories);
	});

	it("does not carry deleted messages into the copy", async () => {
		const db = activateLocalDbScope(nextViewer("alice"));
		const store = createChatStore(db);
		const { room, second } = await filled(db, store);
		await store.deleteMessage(second.id);

		const copy = await store.duplicateRoom(room.id, "copy");

		expect(
			(
				await db.messages
					.where("roomId")
					.equals(copy?.id ?? "")
					.toArray()
			).map((m) => m.content),
		).toEqual(["Open the door"]);
	});

	it("every copied record is a dirty new record, so it syncs as its own conversation", async () => {
		const db = activateLocalDbScope(nextViewer("alice"));
		const store = createChatStore(db);
		const { room } = await filled(db, store);

		const copy = await store.duplicateRoom(room.id, "copy");
		const id = copy?.id ?? "";

		const records = [
			await db.rooms.get(id),
			...(await db.messages.where("roomId").equals(id).toArray()),
			...(await db.chatMemories.where("roomId").equals(id).toArray()),
			...(await db.chatCharacters.where("roomId").equals(id).toArray()),
			await db.chatSummaries.get(summaryIdFor(id)),
		];
		for (const record of records)
			expect(record).toMatchObject({ dirty: 1, serverVersion: 0 });
	});

	it("a deleted or missing room is not copied", async () => {
		const store = createChatStore(activateLocalDbScope(nextViewer("alice")));
		const room = await store.createRoom({ originStoryId: null, seed: seed() });
		await store.deleteRoom(room.id);

		expect(await store.duplicateRoom(room.id, "copy")).toBeNull();
		expect(await store.duplicateRoom("nope", "copy")).toBeNull();
		expect(await store.listRooms()).toEqual([]);
	});

	it("re-checks the title rule", async () => {
		const store = createChatStore(activateLocalDbScope(nextViewer("alice")));
		const room = await store.createRoom({ originStoryId: null, seed: seed() });

		await expect(store.duplicateRoom(room.id, "   ")).rejects.toBeInstanceOf(
			ChatRoomTitleError,
		);
		expect(await store.listRooms()).toHaveLength(1);
	});
});
