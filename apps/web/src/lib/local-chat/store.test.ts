import type { ChatSeed, ChatStore } from "@rowcat/chat";
import {
	CHAT_ROOM_TITLE_MAX_LENGTH,
	ChatMessageContentError,
	ChatMessageRoleError,
	ChatRoomTitleError,
	resolveGenerationOutcome,
} from "@rowcat/chat";
import { StoryChatSeedDto } from "@rowcat/contracts/chat";
import { compareRev } from "@rowcat/sync";
import { afterEach, describe, expect, it } from "vitest";
import {
	activateLocalDbScope,
	activeLocalDbScope,
	type LocalDb,
	resetLocalDbScope,
} from "#/lib/local-data/db.ts";
import { createChatStore } from "./store.ts";

/**
 * Local store tests. This layer holds users' persistent data, so types are not enough. Everything
 * that breaks here breaks silently: broken account isolation looks normal (someone else's chat is
 * just in my list), out-of-order writes only make a conversation odd, and a logout that deletes
 * data is noticed only at the next login. Runs on real IndexedDB (fake-indexeddb) through open and
 * close cycles.
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
 * Each test uses a different member code. Reusing one would carry a previous test's rooms into the
 * next test's database. That is correct behavior (logout does not delete data), not an isolation
 * failure, so tests avoid it by using distinct names. For the same reason no helper wipes the
 * database: a function that deletes a user's chats must not exist in product code.
 */
let sequence = 0;
const nextViewer = (label: string): string => `${label}-${++sequence}`;

const open = (viewerId: string): ChatStore =>
	createChatStore(activateLocalDbScope(viewerId));

afterEach(() => {
	resetLocalDbScope();
});

describe("persistence", () => {
	it("closing and reopening as the same member keeps rooms and messages", async () => {
		const alice = nextViewer("alice");
		const store = open(alice);
		const room = await store.createRoom({
			originStoryId: "story-1",
			seed: seed(),
		});
		await store.appendMessage({
			roomId: room.id,
			role: "user",
			content: "hello",
		});

		// Logout only closes the connection; the data stays.
		resetLocalDbScope();
		expect(activeLocalDbScope()).toBeNull();

		const reopened = open(alice);
		expect(await reopened.getRoom(room.id)).toMatchObject({ id: room.id });
		expect(await reopened.listRecentMessages(room.id)).toHaveLength(1);
	});

	it("signing out does not erase data", async () => {
		/**
		 * This is the most common mistake in logout handling. Deleting the database as 'cleanup' means a
		 * user who logs in again finds every chat gone.
		 */
		const alice = nextViewer("alice");
		const store = open(alice);
		const room = await store.createRoom({
			originStoryId: null,
			seed: seed(),
		});

		resetLocalDbScope();

		expect(await open(alice).getRoom(room.id)).not.toBeNull();
	});
});

/**
 * Covers the end of a generation turn: usage reported by the stream must survive into the saved
 * message, including cache accounting. The test does not mount the hook. It calls the two functions
 * the hook calls, in the same order: the pure rule (resolveGenerationOutcome) and the real store.
 * This gap is the only place the accounting can be lost, and the loss leaves no visible symptom
 * (the screen just does not draw usage).
 */
describe("generation usage persistence", () => {
	it("is finalized with cache accounting included", async () => {
		const store = open(nextViewer("usage"));
		const room = await store.createRoom({
			originStoryId: null,
			seed: seed(),
		});

		const outcome = resolveGenerationOutcome({
			text: "Response",
			end: "completed",
			usage: {
				model: "test/model",
				inputTokens: 9_000,
				cachedInputTokens: 7_000,
				cacheWriteInputTokens: 0,
				outputTokens: 500,
			},
		});
		if (!outcome.message) throw new Error("no message to save");
		await store.appendMessage({ roomId: room.id, ...outcome.message });

		const [stored] = await store.listRecentMessages(room.id);
		expect(stored).toMatchObject({
			model: "test/model",
			inputTokens: 9_000,
			cachedInputTokens: 7_000,
			cacheWriteInputTokens: 0,
			outputTokens: 500,
		});
	});

	it("unknown values are saved **absent**, not as 0", async () => {
		const store = open(nextViewer("usage-unknown"));
		const room = await store.createRoom({
			originStoryId: null,
			seed: seed(),
		});

		const outcome = resolveGenerationOutcome({
			text: "Response",
			end: "completed",
			usage: { model: "test/model", outputTokens: 500 },
		});
		if (!outcome.message) throw new Error("no message to save");
		await store.appendMessage({ roomId: room.id, ...outcome.message });

		const [stored] = await store.listRecentMessages(room.id);
		expect(stored).toMatchObject({ model: "test/model", outputTokens: 500 });
		expect(stored).not.toHaveProperty("inputTokens");
		expect(stored).not.toHaveProperty("cachedInputTokens");
		expect(stored).not.toHaveProperty("cacheWriteInputTokens");
	});

	it("user messages get no generation metadata", async () => {
		const store = open(nextViewer("usage-user"));
		const room = await store.createRoom({
			originStoryId: null,
			seed: seed(),
		});
		await store.appendMessage({
			roomId: room.id,
			role: "user",
			content: "hello",
		});

		const [stored] = await store.listRecentMessages(room.id);
		expect(stored).not.toHaveProperty("model");
		expect(stored).not.toHaveProperty("cachedInputTokens");
	});
});

describe("account isolation", () => {
	it("members cannot see each other's rooms", async () => {
		/**
		 * The point is that isolation comes from database separation, not from a `WHERE owner = ?`
		 * filter. A filter leaks if any one query omits it. With separate databases, a missing condition
		 * cannot expose another member's data.
		 */
		const aliceId = nextViewer("alice");
		const alice = open(aliceId);
		const roomA = await alice.createRoom({
			originStoryId: null,
			seed: seed(),
		});

		const bob = open(nextViewer("bob"));
		expect(await bob.listRooms()).toEqual([]);
		expect(await bob.getRoom(roomA.id)).toBeNull();

		const roomB = await bob.createRoom({ originStoryId: null, seed: seed() });

		const aliceAgain = open(aliceId);
		expect((await aliceAgain.listRooms()).map((r) => r.id)).toEqual([roomA.id]);
		expect(await aliceAgain.getRoom(roomB.id)).toBeNull();
	});

	it("switching accounts closes the previous scope", async () => {
		const aliceId = nextViewer("alice");
		const bobId = nextViewer("bob");
		open(aliceId);
		expect(activeLocalDbScope()).toBe(aliceId);
		open(bobId);
		expect(activeLocalDbScope()).toBe(bobId);
	});
});

describe("atomicity", () => {
	it("appending a message raises the room's activity time", async () => {
		/**
		 * If the two split, the state 'messages exist but the room is still at a months-old position'
		 * remains. To the user, those were one action.
		 */
		const store = open(nextViewer("alice"));
		const room = await store.createRoom({
			originStoryId: null,
			seed: seed(),
		});

		await store.appendMessage({
			roomId: room.id,
			role: "user",
			content: "hello",
		});

		const updated = await store.getRoom(room.id);
		expect(updated?.updatedAt).not.toBe(room.updatedAt);
		expect(new Date(updated?.updatedAt ?? 0).getTime()).toBeGreaterThanOrEqual(
			new Date(room.updatedAt).getTime(),
		);
		// This is a local edit, so the record is dirty again. Future sync uses this flag to pick what to
		// push.
		expect(updated?.dirty).toBe(1);
	});

	/**
	 * No path had touched a live room before (there was no rename UI), so this never surfaced. If a
	 * transaction callback returns another async function's promise directly, Dexie does not count the
	 * writes inside it as its own work, and it commits early (PrematureCommitError).
	 */
	it("touching a live room really commits", async () => {
		const store = open(nextViewer("alice"));
		const room = await store.createRoom({ originStoryId: null, seed: seed() });

		await expect(store.touchRoom(room.id)).resolves.toBeUndefined();

		const touched = await store.getRoom(room.id);
		expect((touched?.updatedAt ?? "") >= room.updatedAt).toBe(true);
		expect(touched?.dirty).toBe(1);
	});

	it("editing a message raises the room's activity time too", async () => {
		const store = open(nextViewer("alice"));
		const room = await store.createRoom({
			originStoryId: null,
			seed: seed(),
		});
		const message = await store.appendMessage({
			roomId: room.id,
			role: "assistant",
			content: "Partial",
		});
		const before = (await store.getRoom(room.id))?.updatedAt ?? "";

		await store.updateMessage(message.id, {
			content: "Complete",
			incomplete: true,
		});

		const after = await store.getRoom(room.id);
		expect((after?.updatedAt ?? "") >= before).toBe(true);
		const stored = (await store.listRecentMessages(room.id))[0];
		expect(stored).toMatchObject({ content: "Complete", incomplete: true });
	});

	it("updating a missing message makes no new row", async () => {
		const store = open(nextViewer("alice"));
		const room = await store.createRoom({
			originStoryId: null,
			seed: seed(),
		});
		await store.updateMessage("does-not-exist", { content: "x" });
		expect(await store.listRecentMessages(room.id)).toEqual([]);
	});
});

describe("sync metadata", () => {
	it("a new record is dirty with server version 0", async () => {
		/**
		 * Sync is not part of this slice, but sync metadata is recorded from now on. Data stored without
		 * it cannot tell 'never uploaded' from 'uploaded with no record', so the first sync would lack
		 * the basis to decide which copy is newer.
		 */
		const store = open(nextViewer("alice"));
		const room = await store.createRoom({
			originStoryId: null,
			seed: seed(),
		});
		expect(room).toMatchObject({ dirty: 1, serverVersion: 0, deletedAt: null });

		const message = await store.appendMessage({
			roomId: room.id,
			role: "user",
			content: "hello",
		});
		expect(message).toMatchObject({
			dirty: 1,
			serverVersion: 0,
			deletedAt: null,
		});
	});

	it("one transaction editing two records gives them different revisions", async () => {
		/**
		 * Adding a message also advances the room's activity time. The two records sync independently, so
		 * they cannot share one revision: a shared value would leave a later merge unable to order them.
		 */
		const store = open(nextViewer("alice"));
		const room = await store.createRoom({ originStoryId: null, seed: seed() });

		const message = await store.appendMessage({
			roomId: room.id,
			role: "user",
			content: "hello",
		});
		const touched = await store.getRoom(room.id);

		expect(message.rev).not.toEqual(room.rev);
		expect(touched?.rev).not.toEqual(message.rev);
		// The clock is monotonic: the counter preserves order even within the same millisecond.
		expect(compareRev(message.rev, room.rev)).toBeGreaterThan(0);
		expect(compareRev(touched?.rev ?? room.rev, message.rev)).toBeGreaterThan(
			0,
		);
	});

	it("ids are made locally without a server round trip", async () => {
		const store = open(nextViewer("alice"));
		const room = await store.createRoom({
			originStoryId: null,
			seed: seed(),
		});
		// Only needs to be a globally stable opaque string; the UUID format is not part of the contract.
		expect(typeof room.id).toBe("string");
		expect(room.id.length).toBeGreaterThan(8);
	});

	it("a room holds the whole playback snapshot", async () => {
		// Holding only the story id means the room cannot be opened once the story is gone.
		const store = open(nextViewer("alice"));
		const room = await store.createRoom({
			originStoryId: "story-1",
			seed: seed(),
		});
		expect((await store.getRoom(room.id))?.seed.version).toBe(1);
	});
});

describe("reads", () => {
	async function seedMessages(store: ChatStore, roomId: string, n: number) {
		const ids: string[] = [];
		for (let i = 0; i < n; i++) {
			const message = await store.appendMessage({
				roomId,
				role: i % 2 === 0 ? "user" : "assistant",
				content: `turn-${i}`,
			});
			ids.push(message.id);
		}
		return ids;
	}

	it("messages come back oldest first", async () => {
		const store = open(nextViewer("alice"));
		const room = await store.createRoom({
			originStoryId: null,
			seed: seed(),
		});
		await seedMessages(store, room.id, 5);

		const messages = await store.listRecentMessages(room.id);
		expect(messages.map((m) => m.content)).toEqual([
			"turn-0",
			"turn-1",
			"turn-2",
			"turn-3",
			"turn-4",
		]);
	});

	it("saving in the same millisecond does not flip the order", async () => {
		/**
		 * Regression guard. When save times tie, the next sort axis (the random UUID `id`) decides the
		 * order, so two quickly consecutive messages appeared reversed in the conversation. This is
		 * common: a user message is saved and the reply is committed right away.
		 */
		const store = open(nextViewer("alice"));
		const room = await store.createRoom({
			originStoryId: null,
			seed: seed(),
		});
		await seedMessages(store, room.id, 20);

		const messages = await store.listRecentMessages(room.id, { limit: 20 });
		expect(messages.map((m) => m.content)).toEqual(
			Array.from({ length: 20 }, (_, i) => `turn-${i}`),
		);
		// The save timestamps must themselves be strictly increasing, so every query path yields the same
		// order.
		const times = messages.map((m) => m.createdAt);
		expect([...times].sort()).toEqual(times);
		expect(new Set(times).size).toBe(times.length);
	});

	it("the recent page is cut from the end", async () => {
		const store = open(nextViewer("alice"));
		const room = await store.createRoom({
			originStoryId: null,
			seed: seed(),
		});
		await seedMessages(store, room.id, 10);

		const page = await store.listRecentMessages(room.id, { limit: 3 });
		expect(page.map((m) => m.content)).toEqual(["turn-7", "turn-8", "turn-9"]);
	});

	/**
	 * Tombstones are filtered before the count, because this result is also the generation history
	 * window (see the implementation note at the query in store.ts).
	 */
	it("deleted messages take no page slots", async () => {
		const store = open(nextViewer("alice"));
		const room = await store.createRoom({
			originStoryId: null,
			seed: seed(),
		});
		const ids = await seedMessages(store, room.id, 10);
		await store.deleteFromMessage(ids[4] as string);
		const fresh = await store.appendMessage({
			roomId: room.id,
			role: "user",
			content: "new",
		});

		const page = await store.listRecentMessages(room.id, { limit: 4 });
		expect(page.map((m) => m.content)).toEqual([
			"turn-1",
			"turn-2",
			"turn-3",
			"new",
		]);

		const older = await store.listRecentMessages(room.id, {
			before: fresh.id,
			limit: 1,
		});
		expect(older.map((m) => m.content)).toEqual(["turn-3"]);
	});

	it("cursor pagination has no duplicates or gaps", async () => {
		/**
		 * Several messages can share a millisecond (quick successive turns), so the cursor cannot point
		 * at one spot by timestamp alone. This checks that the composite index including id resolves it.
		 * If it breaks, scrolling up makes messages vanish or overlap.
		 */
		const store = open(nextViewer("alice"));
		const room = await store.createRoom({
			originStoryId: null,
			seed: seed(),
		});
		const all = await seedMessages(store, room.id, 12);

		const collected: string[] = [];
		let cursor: string | undefined;
		for (;;) {
			const page = await store.listRecentMessages(room.id, {
				limit: 5,
				...(cursor ? { before: cursor } : {}),
			});
			if (!page.length) break;
			collected.unshift(...page.map((m) => m.id));
			cursor = page[0]?.id;
		}

		expect(collected).toEqual(all);
		expect(new Set(collected).size).toBe(all.length);
	});

	it("other rooms' messages do not mix in", async () => {
		const store = open(nextViewer("alice"));
		const roomA = await store.createRoom({
			originStoryId: null,
			seed: seed(),
		});
		const roomB = await store.createRoom({
			originStoryId: null,
			seed: seed(),
		});
		await seedMessages(store, roomA.id, 3);
		await seedMessages(store, roomB.id, 2);

		expect(await store.listRecentMessages(roomA.id)).toHaveLength(3);
		expect(await store.listRecentMessages(roomB.id)).toHaveLength(2);
	});

	it("a cursor pointing at someone else's room opens no page", async () => {
		const store = open(nextViewer("alice"));
		const roomA = await store.createRoom({
			originStoryId: null,
			seed: seed(),
		});
		const roomB = await store.createRoom({
			originStoryId: null,
			seed: seed(),
		});
		await seedMessages(store, roomA.id, 3);
		const [foreign] = await seedMessages(store, roomB.id, 1);

		expect(
			await store.listRecentMessages(roomA.id, { before: foreign }),
		).toEqual([]);
	});

	it("the room list is in recent-activity order", async () => {
		const store = open(nextViewer("alice"));
		const older = await store.createRoom({
			originStoryId: null,
			seed: seed(),
		});
		const newer = await store.createRoom({
			originStoryId: null,
			seed: seed(),
		});
		// Activity reorders the list: the sort key is the last write, not creation order.
		await store.appendMessage({
			roomId: older.id,
			role: "user",
			content: "New activity",
		});

		expect((await store.listRooms()).map((r) => r.id)).toEqual([
			older.id,
			newer.id,
		]);
	});
});

describe("soft delete", () => {
	/**
	 * This batch is the part of the slice that cannot be undone. If the deletion representation is
	 * wrong, the error only surfaces after it has accumulated on users' devices, and fixing it then is
	 * not a migration. It is a transfer of data already exchanged with other devices.
	 */
	it("a deleted message leaves reads but keeps its row", async () => {
		const db = activateLocalDbScope(nextViewer("alice"));
		const store = createChatStore(db);
		const room = await store.createRoom({ originStoryId: null, seed: seed() });
		const first = await store.appendMessage({
			roomId: room.id,
			role: "user",
			content: "Words to delete",
		});
		await store.appendMessage({
			roomId: room.id,
			role: "assistant",
			content: "Words to keep",
		});

		await store.deleteMessage(first.id);

		expect(
			(await store.listRecentMessages(room.id)).map((m) => m.content),
		).toEqual(["Words to keep"]);
		// The row itself must remain, so future sync can convey that the message was deleted.
		const raw = await db.messages.get(first.id);
		expect(raw?.deletedAt).not.toBeNull();
		expect(raw?.dirty).toBe(1);
		expect(raw?.content).toBe("Words to delete");
	});

	it("deleting a message raises the room's activity time too", async () => {
		const store = open(nextViewer("alice"));
		const room = await store.createRoom({ originStoryId: null, seed: seed() });
		const message = await store.appendMessage({
			roomId: room.id,
			role: "user",
			content: "Words to delete",
		});
		const before = (await store.getRoom(room.id))?.updatedAt ?? "";

		await store.deleteMessage(message.id);

		const after = await store.getRoom(room.id);
		expect((after?.updatedAt ?? "") > before).toBe(true);
	});

	it("deleting a room hides the room and its messages", async () => {
		const store = open(nextViewer("alice"));
		const room = await store.createRoom({ originStoryId: null, seed: seed() });
		const other = await store.createRoom({ originStoryId: null, seed: seed() });
		await store.appendMessage({
			roomId: room.id,
			role: "user",
			content: "hello",
		});
		await store.appendMessage({
			roomId: other.id,
			role: "user",
			content: "Someone else's room",
		});

		await store.deleteRoom(room.id);

		expect(await store.getRoom(room.id)).toBeNull();
		expect((await store.listRooms()).map((r) => r.id)).toEqual([other.id]);
		expect(await store.listRecentMessages(room.id)).toEqual([]);
		expect(await store.listRecentMessages(other.id)).toHaveLength(1);
	});

	it("messages taken along by a room deletion upload no tombstones of their own", async () => {
		/**
		 * A room can hold thousands of messages. If every cascaded message became dirty, one deletion
		 * would become thousands of record pushes. Only the room tombstone goes over the wire; the
		 * receiving device runs the same cascade again.
		 */
		const db = activateLocalDbScope(nextViewer("alice"));
		const store = createChatStore(db);
		const room = await store.createRoom({ originStoryId: null, seed: seed() });
		const clean = await store.appendMessage({
			roomId: room.id,
			role: "user",
			content: "Already uploaded message",
		});
		const dirtyOne = await store.appendMessage({
			roomId: room.id,
			role: "assistant",
			content: "Not yet uploaded message",
		});
		// One row is already marked as server-confirmed, the state a future push would leave.
		const stored = await db.messages.get(clean.id);
		if (stored)
			await db.messages.put({ ...stored, dirty: 0, serverVersion: 3 });

		await store.deleteRoom(room.id);

		const afterClean = await db.messages.get(clean.id);
		const afterDirty = await db.messages.get(dirtyOne.id);
		// A clean message stays clean when deleted; the room tombstone covers the subtree.
		expect(afterClean?.deletedAt).not.toBeNull();
		expect(afterClean?.dirty).toBe(0);
		expect(afterClean?.serverVersion).toBe(3);
		expect(afterClean?.rev).toEqual(clean.rev);
		// An already-dirty message keeps its dirty state on deletion. That is the accurate state.
		expect(afterDirty?.deletedAt).not.toBeNull();
		expect(afterDirty?.dirty).toBe(1);
		const deletedRoom = await db.rooms.get(room.id);
		expect(compareRev(deletedRoom?.rev ?? room.rev, room.rev)).toBeGreaterThan(
			0,
		);
	});

	it("deleting the same room twice keeps the first deletion time", async () => {
		const db = activateLocalDbScope(nextViewer("alice"));
		const store = createChatStore(db);
		const room = await store.createRoom({ originStoryId: null, seed: seed() });

		await store.deleteRoom(room.id);
		const first = (await db.rooms.get(room.id))?.deletedAt;
		await store.deleteRoom(room.id);
		const second = await db.rooms.get(room.id);

		expect(second?.deletedAt).toBe(first);
	});

	it("deleting a missing id does nothing", async () => {
		const store = open(nextViewer("alice"));
		await expect(store.deleteRoom("missing-room")).resolves.toBeUndefined();
		await expect(
			store.deleteMessage("missing-message"),
		).resolves.toBeUndefined();
	});

	it("a deleted room does not revive through ordinary writes", async () => {
		/**
		 * A late stream end really opens this path. If the message were revived, the user would see the
		 * deleted chat reappear in the list.
		 */
		const db = activateLocalDbScope(nextViewer("alice"));
		const store = createChatStore(db);
		const room = await store.createRoom({ originStoryId: null, seed: seed() });
		const message = await store.appendMessage({
			roomId: room.id,
			role: "assistant",
			content: "Partial",
		});

		await store.deleteRoom(room.id);

		await store.touchRoom(room.id);
		await store.updateMessage(message.id, { content: "Complete" });
		const late = await store.appendMessage({
			roomId: room.id,
			role: "user",
			content: "Late words",
		});

		expect(await store.getRoom(room.id)).toBeNull();
		expect(await store.listRooms()).toEqual([]);
		expect(await store.listRecentMessages(room.id)).toEqual([]);
		// A message arriving late is also saved as deleted, so it does not become an orphan.
		expect(late.deletedAt).not.toBeNull();
		expect((await db.messages.get(message.id))?.content).toBe("Partial");
	});
});

describe("rename", () => {
	const createRoom = (store: ChatStore, title: string) =>
		store.createRoom({ originStoryId: "story-1", seed: seed(), title });

	it("the title changes and surrounding whitespace is trimmed", async () => {
		const store = open(nextViewer("alice"));
		const room = await createRoom(store, "The Night Library");

		await store.renameRoom(room.id, "  The Day Library  ");

		expect((await store.getRoom(room.id))?.title).toBe("The Day Library");
	});

	/**
	 * A rename is one edit. If title, activity time, revision and dirty flag moved separately, an
	 * intermediate state (new title with the old revision) would be representable, and sync would
	 * replay that state.
	 */
	it("one rename issues one revision and sets dirty", async () => {
		const db = activateLocalDbScope(nextViewer("alice"));
		const store = createChatStore(db);
		const room = await createRoom(store, "First");
		// Simulates a state where the server has confirmed a version; the local edit must not change that
		// value.
		await db.rooms.update(room.id, { dirty: 0, serverVersion: 7 });

		await store.renameRoom(room.id, "Later");

		const renamed = await store.getRoom(room.id);
		expect(renamed?.title).toBe("Later");
		expect(renamed?.dirty).toBe(1);
		expect(renamed?.serverVersion).toBe(7);
		expect(compareRev(renamed?.rev ?? room.rev, room.rev)).toBe(1);
		expect((renamed?.updatedAt ?? "") >= room.updatedAt).toBe(true);
	});

	/**
	 * A rename is activity too: the just-edited chat does not stay at its old position in the list.
	 */
	it("comes first in recent-activity order", async () => {
		const store = open(nextViewer("alice"));
		const first = await createRoom(store, "A");
		await createRoom(store, "B");
		expect((await store.listRooms())[0]?.title).toBe("B");

		await store.renameRoom(first.id, "A-edited");

		expect((await store.listRooms())[0]?.id).toBe(first.id);
	});

	it("a title that breaks the rules is refused and not saved", async () => {
		const store = open(nextViewer("alice"));
		const room = await createRoom(store, "Original title");

		await expect(store.renameRoom(room.id, "   ")).rejects.toThrow(
			ChatRoomTitleError,
		);
		await expect(
			store.renameRoom(room.id, "A".repeat(CHAT_ROOM_TITLE_MAX_LENGTH + 1)),
		).rejects.toThrow(ChatRoomTitleError);

		// Does not silently truncate the title before storing it.
		expect((await store.getRoom(room.id))?.title).toBe("Original title");
	});

	/**
	 * This slice's P1. In two tabs, one deletes while the other's rename arrives late. The race really
	 * happens, and if the rename revived the room, the user would see the deleted chat reappear in the
	 * list.
	 */
	it("a deleted room does not revive by renaming", async () => {
		const db = activateLocalDbScope(nextViewer("alice"));
		const store = createChatStore(db);
		const room = await createRoom(store, "Room to delete");
		await store.deleteRoom(room.id);

		await store.renameRoom(room.id, "Revived room");

		expect(await store.getRoom(room.id)).toBeNull();
		expect(await store.listRooms()).toEqual([]);
		// The title also stays as it was behind the tombstone; no version with nothing to send is
		// created.
		expect((await db.rooms.get(room.id))?.title).toBe("Room to delete");
	});

	/** A missing room is silently ignored, the same contract as deletion and message updates. */
	it("renaming a missing room makes no new row", async () => {
		const store = open(nextViewer("alice"));
		await expect(
			store.renameRoom("missing-room", "Title"),
		).resolves.toBeUndefined();
		expect(await store.listRooms()).toEqual([]);
	});

	/**
	 * The rename happens while a generation is running. If rename saves a stale room object from the
	 * caller, later activity reverts. If the late activity update saves a stale object, the title that
	 * was just changed disappears. Both paths must re-read the room inside the transaction.
	 */
	it("an activity update after a rename does not restore the old title", async () => {
		const store = open(nextViewer("alice"));
		const room = await createRoom(store, "Old title");
		// The room object the screen captured when the generation started. It holds the title as of that
		// moment.
		const captured = room;

		await store.renameRoom(room.id, "New title");
		await store.appendMessage({
			roomId: captured.id,
			role: "assistant",
			content: "generation results",
		});
		await store.touchRoom(captured.id);

		expect((await store.getRoom(room.id))?.title).toBe("New title");
	});
});

/**
 * Tail rewrite: the only irreversible local operation. Getting it wrong either deletes one message
 * too many (the reply being read disappears) or one too few (an old reply remains after the text
 * before it changed). Both look like success on screen, and there is no undo. The ordering rule
 * itself is tested in
 * @rowcat/chat's tail-rewrite.test.ts. This file checks the real transaction: what commits and what
 * remains.
 */
describe("tail rewrite", () => {
	/**
	 * A conversation where user and assistant turns alternate. It must have the same shape as a real
	 * conversation.
	 */
	async function conversation(store: ChatStore, turns: number) {
		const room = await store.createRoom({ originStoryId: null, seed: seed() });
		const ids: string[] = [];
		for (let i = 0; i < turns; i++) {
			const user = await store.appendMessage({
				roomId: room.id,
				role: "user",
				content: `user-${i}`,
			});
			const assistant = await store.appendMessage({
				roomId: room.id,
				role: "assistant",
				content: `assistant-${i}`,
			});
			ids.push(user.id, assistant.id);
		}
		return { room, ids };
	}

	const contents = async (store: ChatStore, roomId: string) =>
		(await store.listRecentMessages(roomId, { limit: 100 })).map(
			(message) => message.content,
		);

	describe("editing user messages", () => {
		it("the last user message: only the content changes and nothing is deleted", async () => {
			const store = open(nextViewer("alice"));
			const { room } = await conversation(store, 1);
			const last = await store.appendMessage({
				roomId: room.id,
				role: "user",
				content: "Original question",
			});

			expect(await store.editUserMessage(last.id, "Edited question")).toEqual({
				applied: true,
				removed: 0,
			});
			expect(await contents(store, room.id)).toEqual([
				"user-0",
				"assistant-0",
				"Edited question",
			]);
		});

		it("a middle user message: everything after goes and everything before stays", async () => {
			const store = open(nextViewer("alice"));
			const { room, ids } = await conversation(store, 3);

			// ids = [u0, a0, u1, a1, u2, a2]; the middle user message is u1.
			expect(await store.editUserMessage(ids[2], "Asking again")).toEqual({
				applied: true,
				removed: 3,
			});

			expect(await contents(store, room.id)).toEqual([
				"user-0",
				"assistant-0",
				"Asking again",
			]);
		});

		/**
		 * An edit is the message's next revision, not a new message. A new id would reach other devices
		 * as a new record, and the old id would live on with no tombstone, reviving forever.
		 */
		it("the anchor's identity and creation time stay; the order does not shift", async () => {
			const store = open(nextViewer("alice"));
			const { room, ids } = await conversation(store, 2);
			const before = (
				await store.listRecentMessages(room.id, { limit: 100 })
			).find((message) => message.id === ids[0]);

			await store.editUserMessage(ids[0], "Edited first utterance");

			const after = (
				await store.listRecentMessages(room.id, { limit: 100 })
			)[0];
			expect(after.id).toBe(ids[0]);
			expect(after.createdAt).toBe(before?.createdAt);
			expect(after.role).toBe("user");
			expect(after.content).toBe("Edited first utterance");
		});

		it("the room's activity time rises: a conversation with edited history is recent", async () => {
			const store = open(nextViewer("alice"));
			const { room, ids } = await conversation(store, 2);
			const before = (await store.getRoom(room.id))?.updatedAt ?? "";

			await store.editUserMessage(ids[0], "Edited");

			const after = await store.getRoom(room.id);
			expect(after?.updatedAt.localeCompare(before)).toBeGreaterThanOrEqual(0);
			expect(after?.dirty).toBe(1);
		});

		it("empty content is refused and the conversation stays; it does not silently become a deletion", async () => {
			const store = open(nextViewer("alice"));
			const { room, ids } = await conversation(store, 2);

			await expect(store.editUserMessage(ids[0], "   ")).rejects.toThrow(
				ChatMessageContentError,
			);
			expect(await contents(store, room.id)).toHaveLength(4);
		});

		/**
		 * Both roles can now be edited, but there are still two doors. An assistant reply entering
		 * through the user door would apply the user-edit rule to someone else's record, so the store
		 * checks the pairing again.
		 */
		it("an assistant message cannot come through this door and the conversation stays", async () => {
			const store = open(nextViewer("alice"));
			const { room, ids } = await conversation(store, 2);

			await expect(
				store.editUserMessage(ids[1], "Answer I wrote"),
			).rejects.toThrow(ChatMessageRoleError);
			expect(await contents(store, room.id)).toHaveLength(4);
		});

		it("a missing or deleted message changes nothing", async () => {
			const store = open(nextViewer("alice"));
			const { room, ids } = await conversation(store, 2);

			expect(await store.editUserMessage("missing-id", "x")).toEqual({
				applied: false,
				removed: 0,
			});
			await store.deleteMessage(ids[0]);
			expect(await store.editUserMessage(ids[0], "x")).toEqual({
				applied: false,
				removed: 0,
			});
			// The deleted anchor was not revived, and the conversation after it is unchanged.
			expect(await contents(store, room.id)).toEqual([
				"assistant-0",
				"user-1",
				"assistant-1",
			]);
		});

		it("a deleted room's message does not revive by editing", async () => {
			const store = open(nextViewer("alice"));
			const { room, ids } = await conversation(store, 1);
			await store.deleteRoom(room.id);

			expect(await store.editUserMessage(ids[0], "Edited")).toEqual({
				applied: false,
				removed: 0,
			});
			expect(await store.getRoom(room.id)).toBeNull();
		});
	});

	describe("editing assistant responses", () => {
		/**
		 * The most common operation: fixing one word in the reply just read. Until now the only option at
		 * that spot was regenerate, which discards the whole text.
		 */
		it("the last response: only the content changes and nothing is deleted", async () => {
			const store = open(nextViewer("alice"));
			const { room, ids } = await conversation(store, 2);
			const target = ids[3] as string;
			const before = (
				await store.listRecentMessages(room.id, { limit: 100 })
			).at(-1)?.createdAt;

			expect(await store.editAssistantMessage(target, "Edited answer")).toEqual(
				{
					applied: true,
					removed: 0,
				},
			);

			const after = (
				await store.listRecentMessages(room.id, { limit: 100 })
			).at(-1);
			expect(after?.id).toBe(target);
			expect(after?.role).toBe("assistant");
			expect(after?.content).toBe("Edited answer");
			/**
			 * The identity axis is left alone; changing the sort key would shift the conversation's order.
			 */
			expect(after?.createdAt).toBe(before);
		});

		/**
		 * Editing an earlier reply deletes everything after it, using the same tail rule as user edits.
		 * Once the earlier text changes, the later replies are chained on text that no longer exists.
		 */
		it("an older response: everything after it goes", async () => {
			const store = open(nextViewer("alice"));
			const { room, ids } = await conversation(store, 3);

			expect(
				await store.editAssistantMessage(ids[1] as string, "Edited"),
			).toEqual({ applied: true, removed: 4 });
			expect(await contents(store, room.id)).toEqual(["user-0", "Edited"]);
		});

		/** Provenance metadata records what the request wrote, not what the text is now. */
		it("model, usage and truncation markers stay", async () => {
			const store = open(nextViewer("alice"));
			const room = await store.createRoom({
				originStoryId: null,
				seed: seed(),
			});
			await store.appendMessage({
				roomId: room.id,
				role: "user",
				content: "hello",
			});
			const answer = await store.appendMessage({
				roomId: room.id,
				role: "assistant",
				content: "Truncated answer",
				model: "claude-sonnet-5",
				outputTokens: 768,
				truncated: true,
			});

			await store.editAssistantMessage(
				answer.id,
				"Truncated answer edited by hand",
			);

			const after = (
				await store.listRecentMessages(room.id, { limit: 100 })
			).at(-1);
			expect(after?.model).toBe("claude-sonnet-5");
			expect(after?.outputTokens).toBe(768);
			/**
			 * Even after a hand edit, the reply is still cut off at the limit. Clearing the flag would leave
			 * the conversation with no way to continue generating.
			 */
			expect(after?.truncated).toBe(true);
		});

		it("empty content is refused and the conversation stays", async () => {
			const store = open(nextViewer("alice"));
			const { room, ids } = await conversation(store, 2);

			await expect(
				store.editAssistantMessage(ids[3] as string, "   "),
			).rejects.toThrow(ChatMessageContentError);
			expect(await contents(store, room.id)).toHaveLength(4);
		});

		/** The reverse pairing is blocked too: user messages cannot enter through the assistant door. */
		it("a user message cannot come through this door", async () => {
			const store = open(nextViewer("alice"));
			const { room, ids } = await conversation(store, 2);

			await expect(
				store.editAssistantMessage(ids[0] as string, "Edited"),
			).rejects.toThrow(ChatMessageRoleError);
			expect(await contents(store, room.id)).toHaveLength(4);
		});

		it("a missing or deleted message changes nothing", async () => {
			const store = open(nextViewer("alice"));
			const { ids } = await conversation(store, 2);

			expect(await store.editAssistantMessage("missing-id", "x")).toEqual({
				applied: false,
				removed: 0,
			});
			await store.deleteMessage(ids[3] as string);
			expect(await store.editAssistantMessage(ids[3] as string, "x")).toEqual({
				applied: false,
				removed: 0,
			});
		});
	});

	describe("delete from here", () => {
		it("the last single message", async () => {
			const store = open(nextViewer("alice"));
			const { room, ids } = await conversation(store, 2);

			expect(await store.deleteFromMessage(ids[3])).toEqual({
				applied: true,
				removed: 1,
			});
			expect(await contents(store, room.id)).toEqual([
				"user-0",
				"assistant-0",
				"user-1",
			]);
		});

		it("a middle message: itself and everything after", async () => {
			const store = open(nextViewer("alice"));
			const { room, ids } = await conversation(store, 3);

			expect(await store.deleteFromMessage(ids[2])).toEqual({
				applied: true,
				removed: 4,
			});
			expect(await contents(store, room.id)).toEqual(["user-0", "assistant-0"]);
		});

		it("the first message: the conversation empties and the room stays", async () => {
			const store = open(nextViewer("alice"));
			const { room, ids } = await conversation(store, 3);

			expect(await store.deleteFromMessage(ids[0])).toEqual({
				applied: true,
				removed: 6,
			});
			expect(await contents(store, room.id)).toEqual([]);
			// The room is not deleted. Clearing a conversation and deleting a conversation are different
			// operations.
			expect(await store.getRoom(room.id)).not.toBeNull();
		});

		it("idempotent: pressing twice keeps the first deletion time", async () => {
			const db = activateLocalDbScope(nextViewer("alice"));
			const store = createChatStore(db);
			const { ids } = await conversation(store, 2);

			await store.deleteFromMessage(ids[2]);
			const first = (await db.messages.get(ids[2]))?.deletedAt;
			expect(await store.deleteFromMessage(ids[2])).toEqual({
				applied: false,
				removed: 0,
			});
			expect((await db.messages.get(ids[2]))?.deletedAt).toBe(first);
		});
	});

	/**
	 * Whether sync can convey this operation. It differs from the room-delete cascade: there, one room
	 * tombstone stands in for the subtree; here there is no parent tombstone to stand in for the tail.
	 * Without a tombstone on each record, other devices would think the messages they know still exist
	 * and re-upload them.
	 */
	describe("sync representation", () => {
		it("each deleted tail message gets a tombstone, a new revision and dirty", async () => {
			const db = activateLocalDbScope(nextViewer("alice"));
			const store = createChatStore(db);
			const { ids } = await conversation(store, 2);
			const before = await db.messages.get(ids[1]);

			await store.deleteFromMessage(ids[1]);

			for (const id of ids.slice(1)) {
				const row = await db.messages.get(id);
				expect(row?.deletedAt).not.toBeNull();
				expect(row?.dirty).toBe(1);
			}
			// Sent with the old revision, the peer would treat it as a replay and ignore it.
			const after = await db.messages.get(ids[1]);
			if (!before || !after) throw new Error("no message");
			expect(compareRev(after.rev, before.rev)).toBeGreaterThan(0);
		});

		it("one rewrite issues a different revision per record", async () => {
			const db = activateLocalDbScope(nextViewer("alice"));
			const store = createChatStore(db);
			const { room, ids } = await conversation(store, 3);

			await store.editUserMessage(ids[2], "Edited");

			const touched = [
				(await db.messages.get(ids[2]))?.rev,
				(await db.messages.get(ids[3]))?.rev,
				(await db.messages.get(ids[4]))?.rev,
				(await db.messages.get(ids[5]))?.rev,
				(await db.rooms.get(room.id))?.rev,
			];
			const keys = touched.map((rev) => `${rev?.t}:${rev?.c}:${rev?.d}`);
			expect(new Set(keys).size).toBe(keys.length);
		});

		it("earlier messages are untouched; clean records are not uploaded again", async () => {
			const db = activateLocalDbScope(nextViewer("alice"));
			const store = createChatStore(db);
			const { ids } = await conversation(store, 3);
			// Simulates a state where sync has already completed.
			for (const id of ids) {
				const row = await db.messages.get(id);
				if (row) await db.messages.put({ ...row, dirty: 0, serverVersion: 1 });
			}

			await store.deleteFromMessage(ids[4]);

			expect((await db.messages.get(ids[0]))?.dirty).toBe(0);
			expect((await db.messages.get(ids[3]))?.dirty).toBe(0);
			expect((await db.messages.get(ids[4]))?.dirty).toBe(1);
		});
	});

	/**
	 * P0. The rewrite finishes inside the room that owns the anchor. If the tail is not narrowed to
	 * that room, messages from every room after the same time get picked up. The symptom is silent:
	 * the user finds out only when opening another conversation, by which time the tombstones have
	 * already reached other devices.
	 */
	it("other rooms' messages are not caught in the tail", async () => {
		const store = open(nextViewer("alice"));
		const first = await conversation(store, 2);
		// The second room is created later. With only the ordering axis, all of its messages would fall
		// into the tail.
		const second = await conversation(store, 2);

		expect(await store.deleteFromMessage(first.ids[0])).toEqual({
			applied: true,
			removed: 4,
		});

		expect(await contents(store, first.room.id)).toEqual([]);
		expect(await contents(store, second.room.id)).toHaveLength(4);
	});

	/**
	 * P0. One member's history operation cannot reach another member's database. Isolation comes from
	 * database separation, not filters, but each new operation must be checked that it does not cross
	 * that boundary.
	 */
	it("another member's message cannot be an anchor", async () => {
		const aliceId = nextViewer("alice");
		const alice = open(aliceId);
		const { room, ids } = await conversation(alice, 2);

		const bob = open(nextViewer("bob"));
		expect(await bob.deleteFromMessage(ids[0])).toEqual({
			applied: false,
			removed: 0,
		});
		expect(
			await bob.editUserMessage(ids[0], "Someone else's conversation"),
		).toEqual({
			applied: false,
			removed: 0,
		});

		expect(await contents(open(aliceId), room.id)).toHaveLength(4);
	});
});

/**
 * The query that search reads. The boundary for 'whose which room is viewed' hangs on this one
 * method. Search itself is a pure function that can be checked without rendering (search.test.ts in
 * @rowcat/chat), but that check cannot tell which member's room it reads. That decision lives here.
 */
describe("all messages of a room", () => {
	it("returns everything ascending, not capped by page size", async () => {
		const store = open(nextViewer("alice"));
		const room = await store.createRoom({ originStoryId: null, seed: seed() });
		for (let index = 0; index < 60; index++)
			await store.appendMessage({
				roomId: room.id,
				role: index % 2 === 0 ? "user" : "assistant",
				content: `Line ${index}`,
			});

		const all = await store.listAllMessages(room.id);
		expect(all).toHaveLength(60);
		expect(all[0]?.content).toBe("Line 0");
		expect(all[59]?.content).toBe("Line 59");
	});

	it("deleted messages are left out", async () => {
		const store = open(nextViewer("alice"));
		const room = await store.createRoom({ originStoryId: null, seed: seed() });
		const kept = await store.appendMessage({
			roomId: room.id,
			role: "user",
			content: "Remaining scene",
		});
		const gone = await store.appendMessage({
			roomId: room.id,
			role: "assistant",
			content: "Vanished scene",
		});
		await store.deleteMessage(gone.id);

		expect((await store.listAllMessages(room.id)).map((m) => m.id)).toEqual([
			kept.id,
		]);
	});

	it("a deleted room is an empty list", async () => {
		const store = open(nextViewer("alice"));
		const room = await store.createRoom({ originStoryId: null, seed: seed() });
		await store.appendMessage({
			roomId: room.id,
			role: "user",
			content: "Night",
		});
		await store.deleteRoom(room.id);

		expect(await store.listAllMessages(room.id)).toEqual([]);
	});

	/**
	 * P1. If room B's messages mixed into the results while searching room A, the results would have
	 * no place to jump to.
	 */
	it("other rooms' messages do not mix in", async () => {
		const store = open(nextViewer("alice"));
		const a = await store.createRoom({ originStoryId: null, seed: seed() });
		const b = await store.createRoom({ originStoryId: null, seed: seed() });
		await store.appendMessage({ roomId: a.id, role: "user", content: "foo A" });
		await store.appendMessage({ roomId: b.id, role: "user", content: "foo B" });

		expect((await store.listAllMessages(a.id)).map((m) => m.content)).toEqual([
			"foo A",
		]);
		expect((await store.listAllMessages(b.id)).map((m) => m.content)).toEqual([
			"foo B",
		]);
	});

	/** P0. No path lets Alice's conversation content reach Bob's screen. */
	it("another member's room does not open", async () => {
		const aliceId = nextViewer("alice");
		const alice = open(aliceId);
		const room = await alice.createRoom({ originStoryId: null, seed: seed() });
		await alice.appendMessage({
			roomId: room.id,
			role: "user",
			content: "secretA",
		});

		const bob = open(nextViewer("bob"));
		expect(await bob.listAllMessages(room.id)).toEqual([]);

		// Alice's data is unchanged: Bob's open touched a different database.
		expect(await open(aliceId).listAllMessages(room.id)).toHaveLength(1);
	});
});

/**
 * A routing-friendly key: one per room, the same value across restarts. This layer is where it must
 * be verified because the failure is silent. If a new value were issued every turn, the chat would
 * look fine, and only the gateway would see each turn as a new conversation. The cost shows up only
 * on the bill.
 */
describe("routing session", () => {
	const create = (store: ChatStore) =>
		store.createRoom({ originStoryId: "story-1", seed: seed() });

	/**
	 * Simulates a row saved before this axis existed. Those records have no key (not even null). This
	 * is the only place a raw row is written without going through the store; it is needed to reach
	 * the lazy-issue state.
	 */
	const dropRoutingSession = async (db: LocalDb, id: string) => {
		const row = await db.rooms.get(id);
		if (!row) throw new Error(`no room: ${id}`);
		const { routingSessionId: _dropped, ...legacy } = row;
		await db.rooms.put(legacy as typeof row);
	};

	it("a new room is born with a value", async () => {
		const room = await create(open(nextViewer("routing")));
		expect(room.routingSessionId).toBeTruthy();
		/** Deriving it from the room id would let upstream trace back to the same conversation. */
		expect(room.routingSessionId).not.toBe(room.id);
	});

	it("closing and reopening keeps the same value", async () => {
		const viewer = nextViewer("routing");
		const created = await create(open(viewer));
		resetLocalDbScope();
		const reopened = await open(viewer).getRoom(created.id);
		expect(reopened?.routingSessionId).toBe(created.routingSessionId);
	});

	it("different rooms have different values", async () => {
		const store = open(nextViewer("routing"));
		const [a, b] = [await create(store), await create(store)];
		expect(a.routingSessionId).not.toBe(b.routingSessionId);
	});

	it("two turns of the same room get the same value", async () => {
		const store = open(nextViewer("routing"));
		const room = await create(store);
		expect(await store.ensureRoomRoutingSession(room.id)).toBe(
			room.routingSessionId,
		);
		expect(await store.ensureRoomRoutingSession(room.id)).toBe(
			room.routingSessionId,
		);
	});

	/**
	 * Rooms created under the old version are the whole reason for this path. Issuing a value without
	 * saving it means every next turn gets yet another value, and the room's cache locality resets
	 * forever.
	 */
	it("a room without a value gets one issued once and persisted", async () => {
		const db = activateLocalDbScope(nextViewer("routing"));
		const store = createChatStore(db);
		const room = await create(store);
		await dropRoutingSession(db, room.id);
		expect((await store.getRoom(room.id))?.routingSessionId).toBeUndefined();

		const issued = await store.ensureRoomRoutingSession(room.id);
		expect(issued).toBeTruthy();
		expect((await store.getRoom(room.id))?.routingSessionId).toBe(issued);
		expect(await store.ensureRoomRoutingSession(room.id)).toBe(issued);
	});

	/**
	 * Not conversation activity. Pushing it would move a months-old conversation to the top of the
	 * list for a reason the user never took, and it would happen only because the room was created
	 * under an old version.
	 */
	it("issuing does not push the room's activity time", async () => {
		const db = activateLocalDbScope(nextViewer("routing"));
		const store = createChatStore(db);
		const room = await create(store);
		await dropRoutingSession(db, room.id);

		await store.ensureRoomRoutingSession(room.id);
		const after = await store.getRoom(room.id);
		expect(after?.updatedAt).toBe(room.updatedAt);
		/** Issuing is a local change and must be uploaded, so other devices write the same value. */
		expect(after?.dirty).toBe(1);
	});

	/**
	 * Do not issue for deleted rooms (no resurrection). Otherwise this turn goes out without the axis.
	 */
	it("a deleted room gets none issued", async () => {
		const store = open(nextViewer("routing"));
		const room = await create(store);
		await store.deleteRoom(room.id);
		expect(await store.ensureRoomRoutingSession(room.id)).toBeNull();
		expect(await store.ensureRoomRoutingSession("missing-room")).toBeNull();
	});
});
