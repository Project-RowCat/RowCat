import {
	type ChatSeed,
	type ChatStore,
	recentSidebarRooms,
} from "@rowcat/chat";
import { StoryChatSeedDto } from "@rowcat/contracts/chat";
import { afterEach, describe, expect, it } from "vitest";
import { createChatStore } from "#/lib/local-chat/store.ts";
import {
	activateLocalDbScope,
	resetLocalDbScope,
} from "#/lib/local-data/db.ts";

/**
 * Which room the sidebar row's management actions reach.
 *
 * No rendering: the web tests have no React. The slice's P0 still reproduces here, because each
 * menu action ends in one store call; the risk is the arguments it is called with, and those can be
 * checked purely.
 *
 * Three mismatches are targeted: after the list is re-sorted, does the action still reach the room
 * first pointed at (pointing by position would delete the neighbor)? When a non-active room is
 * deleted, does the active room stay as it is? And does an action bring back a room that vanished
 * in the meantime?
 */

const seed = (): ChatSeed =>
	StoryChatSeedDto.parse({
		version: 1,
		storyId: "story-1",
		title: "Test story",
		adult: false,
		promptProtected: false,
	});

/** A distinct member id per test; earlier tests' databases are expected to remain. */
let sequence = 0;
const nextViewer = (label: string): string => `${label}-${++sequence}`;

const open = (viewerId: string): ChatStore =>
	createChatStore(activateLocalDbScope(viewerId));

const create = (store: ChatStore, title: string) =>
	store
		.createRoom({ originStoryId: "story-1", seed: seed() })
		.then(async (room) => {
			await store.renameRoom(room.id, title);
			return room.id;
		});

afterEach(() => {
	resetLocalDbScope();
});

describe("the target is the room id", () => {
	/**
	 * This slice's P0. The list can be re-sorted at any time while the menu is open: another tab
	 * sending a message, or sync applying a remote change, makes `liveQuery` reorder it at once. An
	 * action holding a row index would then delete a different conversation from the one the user
	 * picked.
	 */
	it("the room first pointed at is deleted even if the list re-sorts", async () => {
		const store = open(nextViewer("alice"));
		const first = await create(store, "room made first");
		const target = await create(store, "room whose menu was opened");

		// The list when the menu opened; `target` is at the top.
		const openedAt = recentSidebarRooms(await store.listRooms(), null);
		expect(openedAt.map((room) => room.id)).toEqual([target, first]);

		// Another room gets activity while the menu is open.
		await store.appendMessage({
			roomId: first,
			role: "user",
			content: "hi",
			speaker: "",
		});
		const reordered = recentSidebarRooms(await store.listRooms(), null);
		expect(reordered.map((room) => room.id)).toEqual([first, target]);

		// The action goes by id, not by position.
		await store.deleteRoom(target);

		expect((await store.listRooms()).map((room) => room.id)).toEqual([first]);
		expect(await store.getRoom(target)).toBeNull();
	});

	it("renaming follows the same axis", async () => {
		const store = open(nextViewer("alice"));
		const first = await create(store, "room made first");
		const target = await create(store, "room whose menu was opened");

		await store.appendMessage({
			roomId: first,
			role: "user",
			content: "hi",
			speaker: "",
		});
		await store.renameRoom(target, "new name");

		expect((await store.getRoom(target))?.title).toBe("new name");
		expect((await store.getRoom(first))?.title).toBe("room made first");
	});
});

describe("acting on a non-active room leaves the active room alone", () => {
	/**
	 * This is where the sidebar differs from the list screen. Deleting on `/chats` naturally keeps you
	 * on that screen, but the sidebar menu opens **in the middle of another conversation**, so the
	 * active conversation must not move at all.
	 */
	it("only the deleted room leaves the list and the active room stays", async () => {
		const store = open(nextViewer("alice"));
		const activeRoom = await create(store, "current conversation");
		const other = await create(store, "conversation to delete");

		await store.deleteRoom(other);

		const rows = recentSidebarRooms(await store.listRooms(), activeRoom);
		expect(rows.map((room) => room.id)).toEqual([activeRoom]);
		// The active room's messages are intact too: the cascade only touches the deleted room.
		expect(await store.getRoom(activeRoom)).not.toBeNull();
	});

	it("renaming another room does not bump the active room's activity time", async () => {
		const store = open(nextViewer("alice"));
		const activeRoom = await create(store, "current conversation");
		const other = await create(store, "conversation to rename");
		const before = (await store.getRoom(activeRoom))?.updatedAt;

		await store.renameRoom(other, "renamed");

		expect((await store.getRoom(activeRoom))?.updatedAt).toBe(before);
	});
});

describe("when the target disappears while the menu is open", () => {
	/**
	 * Another tab deleted the room, or sync received its tombstone. The screen closes the dialog at
	 * that point (the target room is re-subscribed in the store), but a confirmation that was already
	 * pressed can still arrive late. If it overwrote the tombstone, the deleted conversation would
	 * reappear in the list.
	 */
	it("a late rename does not resurrect a deleted room", async () => {
		const store = open(nextViewer("alice"));
		const target = await create(store, "room about to vanish");

		await store.deleteRoom(target);
		await store.renameRoom(target, "resurrected room");

		expect(await store.getRoom(target)).toBeNull();
		expect(recentSidebarRooms(await store.listRooms(), null)).toEqual([]);
	});

	it("a late delete does nothing", async () => {
		const store = open(nextViewer("alice"));
		const target = await create(store, "room about to vanish");
		await store.deleteRoom(target);

		await expect(store.deleteRoom(target)).resolves.toBeUndefined();
		expect(await store.listRooms()).toEqual([]);
	});
});

/**
 * The menu knows nothing about sync; the marks the actions leave are the entire bridge. No code on
 * this path calls `syncNow()`, yet the change reaches other devices: the write creates a dirty
 * record, and the write signal wrapped at the assembly point wakes auto-sync
 * (`lib/local-data/stores.ts`).
 */
describe("what the actions leave behind", () => {
	it("renaming leaves dirty, deleting leaves a tombstone", async () => {
		const db = activateLocalDbScope(nextViewer("alice"));
		const store = createChatStore(db);
		const renamed = await create(store, "room to rename");
		const removed = await create(store, "room to delete");

		// Assume the server already confirmed this version, so the dirty flag comes from this action.
		await db.rooms.update(renamed, { dirty: 0, serverVersion: 7 });
		await db.rooms.update(removed, { dirty: 0, serverVersion: 7 });

		await store.renameRoom(renamed, "renamed");
		await store.deleteRoom(removed);

		expect(await db.rooms.get(renamed)).toMatchObject({
			title: "renamed",
			dirty: 1,
			serverVersion: 7,
		});
		const tombstone = await db.rooms.get(removed);
		expect(tombstone?.dirty).toBe(1);
		expect(tombstone?.deletedAt).not.toBeNull();
	});
});
