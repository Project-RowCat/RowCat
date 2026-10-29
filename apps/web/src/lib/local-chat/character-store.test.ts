import type { ChatStore } from "@rowcat/chat";
import {
	CHAT_CHARACTER_MAX_PER_ROOM,
	ChatCharacterFieldError,
	ChatCharacterLimitError,
	ChatRoomMissingError,
} from "@rowcat/chat";
import { StoryChatSeedDto } from "@rowcat/contracts/chat";
import { afterEach, describe, expect, it } from "vitest";
import {
	activateLocalDbScope,
	resetLocalDbScope,
} from "#/lib/local-data/db.ts";
import { createChatStore } from "./store.ts";

/**
 * The room's fourth child, tested on real IndexedDB.
 *
 * Types alone don't verify three things: whether deleting a room removes its characters in the same
 * transaction, whether a character can be created in a deleted room, and whether the store enforces
 * the count limit. The first matters most. If it is missed, orphaned characters remain on that
 * device, and the next sync uploads the characters of an already-deleted room back to the server.
 */

let sequence = 0;
const nextViewer = (label: string): string => `${label}-${++sequence}`;
const open = (viewerId: string): ChatStore =>
	createChatStore(activateLocalDbScope(viewerId));

const roomWith = (store: ChatStore) =>
	store.createRoom({
		originStoryId: null,
		seed: StoryChatSeedDto.parse({
			version: 1,
			storyId: "story-1",
			title: "Test story",
			adult: false,
			promptProtected: false,
		}),
	});

afterEach(() => {
	resetLocalDbScope();
});

describe("characters", () => {
	it("creates and reads back from the list", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);

		const created = await store.createCharacter({
			roomId: room.id,
			name: "Yujin",
			prompt: "17. Blunt.",
		});

		expect(await store.listCharacters(room.id)).toEqual([created]);
	});

	/** Order is set by the store, and the screen and prompt assembly both see the same order. */
	it("comes back in creation order", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);
		await store.createCharacter({ roomId: room.id, name: "One" });
		await store.createCharacter({ roomId: room.id, name: "Two" });

		expect((await store.listCharacters(room.id)).map((c) => c.name)).toEqual([
			"One",
			"Two",
		]);
	});

	it("editing changes only that field and raises the revision", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);
		const created = await store.createCharacter({
			roomId: room.id,
			name: "Yujin",
			prompt: "Blunt",
		});

		await store.updateCharacter(created.id, { name: "Yujin (renamed)" });

		const [updated] = await store.listCharacters(room.id);
		expect(updated?.name).toBe("Yujin (renamed)");
		expect(updated?.prompt).toBe("Blunt");
		expect(updated?.dirty).toBeTruthy();
	});

	/**
	 * Editing a character does not touch the room's activity time. Refining a character's description
	 * in an old room must not bring that conversation to the top of the list, because the user would
	 * read it as something they did not do (the same judgment as memory edits).
	 */
	it("editing a character does not lift the room up the list", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);
		const created = await store.createCharacter({
			roomId: room.id,
			name: "Yujin",
		});
		const before = (await store.getRoom(room.id))?.updatedAt;

		await store.updateCharacter(created.id, { prompt: "Edited" });

		expect((await store.getRoom(room.id))?.updatedAt).toBe(before);
	});

	it("deleting removes it from the list but keeps the row as a tombstone", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);
		const created = await store.createCharacter({
			roomId: room.id,
			name: "Yujin",
		});

		await store.deleteCharacter(created.id);
		expect(await store.listCharacters(room.id)).toEqual([]);
		/** Idempotent: two tabs deleting the same character really does happen. */
		await expect(store.deleteCharacter(created.id)).resolves.toBeUndefined();
	});

	/**
	 * Deleting a room removes its characters too. If this is missed, orphaned characters remain on
	 * that device, and the next outbound collection uploads the characters of an already-deleted room
	 * to the server.
	 */
	it("deleting the room deletes its characters too", async () => {
		const db = activateLocalDbScope(nextViewer("alice"));
		const store = createChatStore(db);
		const room = await roomWith(store);
		const created = await store.createCharacter({
			roomId: room.id,
			name: "Yujin",
		});

		await store.deleteRoom(room.id);

		expect(await store.listCharacters(room.id)).toEqual([]);
		/**
		 * The assertion above guards nothing by itself. List queries check the room first, so once the
		 * room is deleted the result is an empty array even if the character rows remain. For a time this
		 * test passed vacuously that way. What must be guarded is the tombstone on the row itself.
		 */
		const row = await db.chatCharacters.get(created.id);
		expect(row?.deletedAt).not.toBeNull();
	});

	/** Structurally, there is no path that revives a deleted room by adding a character. */
	it("a deleted room cannot get characters", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);
		await store.deleteRoom(room.id);

		await expect(
			store.createCharacter({ roomId: room.id, name: "Yujin" }),
		).rejects.toBeInstanceOf(ChatRoomMissingError);
	});

	/**
	 * A value that breaks the rule, if stored, is rejected by the receiving device's decoder at the
	 * next sync.
	 */
	it("a character without a name is not saved", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);

		await expect(
			store.createCharacter({ roomId: room.id, name: "   " }),
		).rejects.toBeInstanceOf(ChatCharacterFieldError);
	});

	/** The count limit is also enforced by the store. Button checks on screen cannot stop two tabs. */
	it("refuses past the cap", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);
		for (let at = 0; at < CHAT_CHARACTER_MAX_PER_ROOM; at++)
			await store.createCharacter({ roomId: room.id, name: `Character${at}` });

		await expect(
			store.createCharacter({ roomId: room.id, name: "One more" }),
		).rejects.toBeInstanceOf(ChatCharacterLimitError);
	});

	it("another room's characters are not visible", async () => {
		const store = open(nextViewer("alice"));
		const a = await roomWith(store);
		const b = await roomWith(store);
		await store.createCharacter({ roomId: a.id, name: "Yujin" });

		expect(await store.listCharacters(b.id)).toEqual([]);
	});
});
