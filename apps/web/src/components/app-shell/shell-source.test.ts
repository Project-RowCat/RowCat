import { type ChatSeed, recentSidebarRooms } from "@rowcat/chat";
import { StoryChatSeedDto } from "@rowcat/contracts/chat";
import { afterEach, describe, expect, it } from "vitest";
import { createAuthoringStore } from "#/lib/local-authoring/store.ts";
import { createChatStore } from "#/lib/local-chat/store.ts";
import {
	activateLocalDbScope,
	resetLocalDbScope,
} from "#/lib/local-data/db.ts";

/**
 * What the shell **actually reads**: the per-member IndexedDB.
 *
 * The sidebar's recent conversations, and the header's room and draft titles, all come from the
 * same local database. The fact that nothing here queries the server is also why this test is
 * meaningful: the database opened here is the one the screen opens.
 *
 * This stops at the store query plus the trimming rule, with no render in between. The component
 * adds nothing between them (`useLocalRooms`, `useLocalRoom` and `useLocalDraft` only subscribe),
 * and the failures here are all silent: another member's room in the sidebar still looks normal, a
 * deleted room still shows until you press it, and a wrong order just looks odd.
 */

const seed = (): ChatSeed =>
	StoryChatSeedDto.parse({
		version: 1,
		storyId: "story-1",
		title: "Test story",
		adult: false,
		promptProtected: false,
	});

/**
 * Each test uses a different member code. Reusing one would carry over resources from earlier
 * tests, which is correct behavior (logging out does not erase data), not a failure of isolation.
 */
let sequence = 0;
const nextViewer = (label: string): string => `${label}-${++sequence}`;

const openChat = (viewerId: string) =>
	createChatStore(activateLocalDbScope(viewerId));
const openAuthoring = (viewerId: string) =>
	createAuthoringStore(activateLocalDbScope(viewerId));

afterEach(() => {
	resetLocalDbScope();
});

describe("account isolation", () => {
	/** The quietest way the sidebar could be wrong, and the worst. */
	it("Alice's conversations are not in Bob's sidebar", async () => {
		const alice = nextViewer("alice");
		const bob = nextViewer("bob");

		const aliceStore = openChat(alice);
		await aliceStore.createRoom({ originStoryId: "story-1", seed: seed() });
		expect(recentSidebarRooms(await aliceStore.listRooms(), null)).toHaveLength(
			1,
		);

		// Log out, then another member logs in. This is the same order the app follows.
		resetLocalDbScope();
		const bobStore = openChat(bob);
		expect(await bobStore.listRooms()).toEqual([]);
	});

	/**
	 * Logging in again as the same member opens **the same physical database.** Logging out does not
	 * erase the device's conversations, and the sidebar must show exactly that.
	 */
	it("signing back in as the same member keeps them", async () => {
		const alice = nextViewer("alice");
		const first = openChat(alice);
		const room = await first.createRoom({
			originStoryId: "story-1",
			seed: seed(),
		});

		resetLocalDbScope();
		const again = openChat(alice);
		expect((await again.listRooms()).map((r) => r.id)).toEqual([room.id]);
	});

	/** Drafts follow the same boundary. The draft title in the header reads this database. */
	it("Alice's drafts are not Bob's", async () => {
		const alice = nextViewer("alice");
		const bob = nextViewer("bob");

		const aliceStore = openAuthoring(alice);
		await aliceStore.createDraft({ title: "Alice's manuscript" });

		resetLocalDbScope();
		const bobStore = openAuthoring(bob);
		expect(await bobStore.listDrafts()).toEqual([]);
	});
});

describe("deleted rooms are not in the sidebar", () => {
	it("Deleted room", async () => {
		const store = openChat(nextViewer("alice"));
		const kept = await store.createRoom({
			originStoryId: "story-1",
			seed: seed(),
		});
		const removed = await store.createRoom({
			originStoryId: "story-1",
			seed: seed(),
		});

		await store.deleteRoom(removed.id);
		expect(
			recentSidebarRooms(await store.listRooms(), null).map((r) => r.id),
		).toEqual([kept.id]);
	});

	/**
	 * The case where the deleted room is **the one currently open** (a deep link was pressed, then the
	 * room was deleted in the meantime). The rule that brings the active room in from outside the
	 * window must not resurrect a tombstone. Otherwise the canvas says "not found" while the sidebar
	 * shows that room lit.
	 */
	it("does not revive the open room once deleted", async () => {
		const store = openChat(nextViewer("alice"));
		const sibling = await store.createRoom({
			originStoryId: "story-1",
			seed: seed(),
		});
		const open = await store.createRoom({
			originStoryId: "story-1",
			seed: seed(),
		});

		await store.deleteRoom(open.id);
		const rows = recentSidebarRooms(await store.listRooms(), open.id);
		// The sibling must stay reachable: one deep link must not block the sidebar.
		expect(rows.map((r) => r.id)).toEqual([sibling.id]);
	});
});

describe("order follows the store's recency axis", () => {
	/**
	 * Appending a message raises the room's activity time in the same transaction. If the sidebar kept
	 * its own recent-time value, the two orders would diverge from that moment on.
	 */
	it("the room that got a message comes first", async () => {
		const store = openChat(nextViewer("alice"));
		const older = await store.createRoom({
			originStoryId: "story-1",
			seed: seed(),
		});
		const newer = await store.createRoom({
			originStoryId: "story-1",
			seed: seed(),
		});
		expect((await store.listRooms()).map((r) => r.id)).toEqual([
			newer.id,
			older.id,
		]);

		await store.appendMessage({
			roomId: older.id,
			role: "user",
			content: "hello",
			speaker: "",
		});
		expect(
			recentSidebarRooms(await store.listRooms(), null).map((r) => r.id),
		).toEqual([older.id, newer.id]);
	});
});

/**
 * The name the header reads comes from the same record.
 *
 * There is only one way to rename, and this checks it. Changing the store updates the sidebar row
 * and the header label **at the same moment**, because both watch this record through `liveQuery`.
 * If the header held a copy of the title in route state or the query cache, this test would miss
 * the resulting drift.
 */
describe("the name the header reads", () => {
	it("renaming changes the room record", async () => {
		const store = openChat(nextViewer("alice"));
		const room = await store.createRoom({
			originStoryId: "story-1",
			seed: seed(),
		});

		await store.renameRoom(room.id, "New name");
		expect((await store.getRoom(room.id))?.title).toBe("New name");
		// The sidebar row reads the same value too. There is no copy.
		expect(
			recentSidebarRooms(await store.listRooms(), room.id).map((r) => r.title),
		).toEqual(["New name"]);
	});

	it("editing the draft title changes the draft record", async () => {
		const store = openAuthoring(nextViewer("alice"));
		const draft = await store.createDraft({ title: "First title" });

		await store.updateDraft(draft.id, { title: "Edited title" });
		expect((await store.getDraft(draft.id))?.title).toBe("Edited title");
	});
});
