import type { ChatSeed, ChatStore } from "@rowcat/chat";
import {
	CHAT_MEMORY_CONTENT_MAX_LENGTH,
	CHAT_MEMORY_MAX_PER_ROOM,
	ChatMemoryContentError,
	ChatMemoryLimitError,
	ChatRoomMissingError,
} from "@rowcat/chat";
import { StoryChatSeedDto } from "@rowcat/contracts/chat";
import { compareRev } from "@rowcat/sync";
import { afterEach, describe, expect, it } from "vitest";
import {
	activateLocalDbScope,
	type LocalDb,
	resetLocalDbScope,
} from "#/lib/local-data/db.ts";
import { createChatStore } from "./store.ts";

/**
 * Memory store tests against real IndexedDB (fake-indexeddb). The file is separate because the
 * target differs: store.test.ts covers the room and message contract, while here memories must hold
 * as children of a room:
 * - room isolation and member isolation
 * - cascade on room delete
 * - deleted rooms are never revived If any of these breaks, the screen still looks normal:
 *   another member's memories enter my prompt, memories of a deleted chat go up to the server, or
 *   the deleted chat comes back.
 */

const seed = (): ChatSeed =>
	StoryChatSeedDto.parse({
		version: 1,
		storyId: "story-1",
		title: "Test story",
		adult: false,
		promptProtected: false,
	});

let sequence = 0;
const nextViewer = (label: string): string => `${label}-mem-${++sequence}`;

const open = (viewerId: string): ChatStore =>
	createChatStore(activateLocalDbScope(viewerId));

/** Tombstones are only visible through the raw table; the port does not return deleted items. */
const rawDb = (viewerId: string): LocalDb => activateLocalDbScope(viewerId);

afterEach(() => {
	resetLocalDbScope();
});

const roomWith = async (store: ChatStore) =>
	store.createRoom({ originStoryId: "story-1", seed: seed() });

describe("basic operations", () => {
	it("creates, reads, edits and deletes", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);

		const created = await store.createMemory({
			roomId: room.id,
			content: "  The persona is left-handed.  ",
		});
		expect(created.content).toBe("The persona is left-handed.");
		expect(created.roomId).toBe(room.id);
		expect(await store.listMemories(room.id)).toHaveLength(1);

		await store.updateMemory(created.id, {
			content: "The persona is right-handed.",
		});
		const [updated] = await store.listMemories(room.id);
		// Identity is preserved: an edit happens in place, not as a delete and recreate.
		expect(updated.id).toBe(created.id);
		expect(updated.content).toBe("The persona is right-handed.");
		expect(updated.createdAt).toBe(created.createdAt);

		await store.deleteMemory(created.id);
		expect(await store.listMemories(room.id)).toHaveLength(0);
	});

	it("pinning and unpinning leave the content alone", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);
		const created = await store.createMemory({
			roomId: room.id,
			content: "Memory",
		});

		await store.updateMemory(created.id, { pinned: true });
		expect((await store.listMemories(room.id))[0]).toMatchObject({
			pinned: true,
			content: "Memory",
		});

		await store.updateMemory(created.id, { pinned: false });
		expect((await store.listMemories(room.id))[0].pinned).toBe(false);
	});

	it("the list is pinned first, then by recent edit", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);
		const first = await store.createMemory({ roomId: room.id, content: "A" });
		const second = await store.createMemory({ roomId: room.id, content: "B" });
		await store.updateMemory(first.id, { pinned: true });

		expect((await store.listMemories(room.id)).map((m) => m.content)).toEqual([
			"A",
			"B",
		]);
		// After unpinning, the most recently edited memory sorts first. A was just edited.
		await store.updateMemory(first.id, { pinned: false });
		expect((await store.listMemories(room.id)).map((m) => m.id)).toEqual([
			first.id,
			second.id,
		]);
	});

	it("content that breaks the rules is refused and not saved", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);

		await expect(
			store.createMemory({ roomId: room.id, content: "   " }),
		).rejects.toBeInstanceOf(ChatMemoryContentError);
		await expect(
			store.createMemory({
				roomId: room.id,
				content: "A".repeat(CHAT_MEMORY_CONTENT_MAX_LENGTH + 1),
			}),
		).rejects.toBeInstanceOf(ChatMemoryContentError);
		expect(await store.listMemories(room.id)).toHaveLength(0);

		const ok = await store.createMemory({ roomId: room.id, content: "Memory" });
		await expect(
			store.updateMemory(ok.id, { content: "" }),
		).rejects.toBeInstanceOf(ChatMemoryContentError);
		expect((await store.listMemories(room.id))[0].content).toBe("Memory");
	});

	it("the store enforces the per-room cap", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);
		for (let index = 0; index < CHAT_MEMORY_MAX_PER_ROOM; index++)
			await store.createMemory({ roomId: room.id, content: `Memory ${index}` });

		await expect(
			store.createMemory({ roomId: room.id, content: "One more" }),
		).rejects.toBeInstanceOf(ChatMemoryLimitError);

		// Deleting one frees a slot again: the cap counts only live memories.
		const [first] = await store.listMemories(room.id);
		await store.deleteMemory(first.id);
		await expect(
			store.createMemory({ roomId: room.id, content: "One more" }),
		).resolves.toBeTruthy();
	});
});

describe("isolation", () => {
	it("other rooms' memories do not mix in", async () => {
		const store = open(nextViewer("alice"));
		const a = await roomWith(store);
		const b = await roomWith(store);
		await store.createMemory({ roomId: a.id, content: "A's memory" });
		await store.createMemory({ roomId: b.id, content: "B's memory" });

		expect((await store.listMemories(a.id)).map((m) => m.content)).toEqual([
			"A's memory",
		]);
		expect((await store.listMemories(b.id)).map((m) => m.content)).toEqual([
			"B's memory",
		]);
	});

	it("members cannot see each other's memories", async () => {
		const alice = nextViewer("alice");
		const bob = nextViewer("bob");

		const aliceStore = open(alice);
		const aliceRoom = await roomWith(aliceStore);
		await aliceStore.createMemory({
			roomId: aliceRoom.id,
			content: "Alice's memory",
		});

		/**
		 * Bob asks for the same room id and gets nothing, because Bob's database has no such room.
		 * Isolation comes from the address (a per-member database), not a query condition, so there is no
		 * condition to forget.
		 */
		const bobStore = open(bob);
		expect(await bobStore.listMemories(aliceRoom.id)).toHaveLength(0);

		// Alice's memories are still there when she comes back, because logout does not erase data.
		expect(await open(alice).listMemories(aliceRoom.id)).toHaveLength(1);
	});
});

describe("room deletion", () => {
	it("deleting a room hides its memories", async () => {
		const viewer = nextViewer("alice");
		const store = open(viewer);
		const room = await roomWith(store);
		await store.createMemory({ roomId: room.id, content: "Memory" });

		await store.deleteRoom(room.id);
		expect(await store.listMemories(room.id)).toHaveLength(0);
	});

	it("memories taken along upload no tombstones of their own", async () => {
		const viewer = nextViewer("alice");
		const store = open(viewer);
		const room = await roomWith(store);
		const memory = await store.createMemory({
			roomId: room.id,
			content: "Memory",
		});
		const before = await rawDb(viewer).chatMemories.get(memory.id);
		if (!before) throw new Error("no memory row");

		await store.deleteRoom(room.id);

		const after = await rawDb(viewer).chatMemories.get(memory.id);
		if (!after)
			throw new Error("the cascade deleted the row; it must be a soft delete");
		// The row stays and is tombstoned.
		expect(after.deletedAt).not.toBeNull();
		/**
		 * dirty and the revision are not bumped: only the room tombstone goes over the wire, and the
		 * receiving device runs the same cascade again. Marking dirty here would turn one room deletion
		 * into hundreds of memory pushes.
		 */
		expect(after.dirty).toBe(before.dirty);
		expect(compareRev(after.rev, before.rev)).toBe(0);
	});

	it("a deleted room cannot get memories; the room does not revive", async () => {
		const viewer = nextViewer("alice");
		const store = open(viewer);
		const room = await roomWith(store);
		await store.deleteRoom(room.id);

		await expect(
			store.createMemory({ roomId: room.id, content: "Late addition" }),
		).rejects.toBeInstanceOf(ChatRoomMissingError);
		expect(await store.getRoom(room.id)).toBeNull();
		expect(await rawDb(viewer).chatMemories.count()).toBe(0);
	});

	it("a deleted room's memory does not revive by update or delete", async () => {
		const viewer = nextViewer("alice");
		const store = open(viewer);
		const room = await roomWith(store);
		const memory = await store.createMemory({
			roomId: room.id,
			content: "Memory",
		});
		await store.deleteRoom(room.id);

		// Late operations arriving from a memory window that is open in another tab.
		await store.updateMemory(memory.id, { content: "Edited content" });
		await store.updateMemory(memory.id, { pinned: true });
		await store.deleteMemory(memory.id);

		const row = await rawDb(viewer).chatMemories.get(memory.id);
		expect(row?.content).toBe("Memory");
		expect(row?.pinned).toBe(false);
		expect(await store.getRoom(room.id)).toBeNull();
	});

	it("operations on a missing room or memory make no new row", async () => {
		const viewer = nextViewer("alice");
		const store = open(viewer);
		await store.updateMemory("missing-memory", { content: "Content" });
		await store.deleteMemory("missing-memory");
		expect(await store.listMemories("missing-room")).toHaveLength(0);
		expect(await rawDb(viewer).chatMemories.count()).toBe(0);
	});
});

describe("sync metadata", () => {
	it("an edit raises the revision and sets dirty", async () => {
		const viewer = nextViewer("alice");
		const store = open(viewer);
		const room = await roomWith(store);
		const created = await store.createMemory({
			roomId: room.id,
			content: "Memory",
		});

		// Simulates the state after a push has completed.
		await rawDb(viewer).chatMemories.put({
			...created,
			dirty: 0,
			serverVersion: 3,
		});

		await store.updateMemory(created.id, { content: "Edited memory" });
		const row = await rawDb(viewer).chatMemories.get(created.id);
		expect(row?.dirty).toBe(1);
		// Local edits do not change the server-confirmed version (serverVersion), but the local revision
		// advances.
		expect(row?.serverVersion).toBe(3);
		expect(compareRev(row?.rev ?? created.rev, created.rev)).toBeGreaterThan(0);
	});

	it("editing a memory does not raise the room's activity time", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);
		const before = (await store.getRoom(room.id))?.updatedAt;

		const memory = await store.createMemory({
			roomId: room.id,
			content: "Memory",
		});
		await store.updateMemory(memory.id, { pinned: true });
		await store.deleteMemory(memory.id);

		/**
		 * Memory curation is not conversation. Touching the room to fix one memory of an old chat would
		 * move that chat to the top, and the user would see a chat they did not touch as recent.
		 */
		expect((await store.getRoom(room.id))?.updatedAt).toBe(before);
	});

	it("deletion is soft: the row stays and propagates to other devices", async () => {
		const viewer = nextViewer("alice");
		const store = open(viewer);
		const room = await roomWith(store);
		const memory = await store.createMemory({
			roomId: room.id,
			content: "Memory",
		});
		await store.deleteMemory(memory.id);

		const row = await rawDb(viewer).chatMemories.get(memory.id);
		expect(row).toBeDefined();
		expect(row?.deletedAt).not.toBeNull();
		expect(row?.dirty).toBe(1);
	});

	it("deleting twice keeps the first deletion time", async () => {
		const viewer = nextViewer("alice");
		const store = open(viewer);
		const room = await roomWith(store);
		const memory = await store.createMemory({
			roomId: room.id,
			content: "Memory",
		});
		await store.deleteMemory(memory.id);
		const first = (await rawDb(viewer).chatMemories.get(memory.id))?.deletedAt;
		await store.deleteMemory(memory.id);
		expect((await rawDb(viewer).chatMemories.get(memory.id))?.deletedAt).toBe(
			first,
		);
	});
});
