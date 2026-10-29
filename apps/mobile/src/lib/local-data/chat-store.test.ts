import type { ChatStore } from "@rowcat/chat";
import {
	CHAT_USER_NOTE_MAX_LENGTH,
	ChatMemoryContentError,
	ChatRoomMissingError,
	ChatUserNoteError,
} from "@rowcat/chat";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seed } from "../../test/fixtures.ts";
import {
	createMemorySecureStorage,
	createTempDirectory,
	createTestScopeController,
} from "../../test/sqlite-node.ts";
import type { LocalScopeController } from "./activation.ts";
import type { MobileDatabase } from "./sqlite.ts";

/**
 * The SQLite `ChatStore` — **the same behaviour matrix** as the web adapter.
 *
 * What is checked here is not whether the SQL runs but the port's contract: tombstones are
 * invisible, a late write does not revive what was deleted, and a room's activity time rises
 * **together with** its messages. If any one of those three differs, the symptom appears not on
 * this device but at the **next sync**.
 */

let temp: ReturnType<typeof createTempDirectory>;
let controller: LocalScopeController;
let chat: ChatStore;
let db: MobileDatabase;

beforeEach(async () => {
	temp = createTempDirectory();
	controller = createTestScopeController(
		temp.path,
		createMemorySecureStorage(),
	);
	const scope = await controller.activate("alice");
	chat = scope.stores.chat;
	db = scope.db;
});

afterEach(async () => {
	await controller.release();
	temp.dispose();
});

const newRoom = (title = "The Night Library") =>
	chat.createRoom({ originStoryId: "story-1", seed: seed(title), title });

describe("Room", () => {
	it("creates and reads back — down to the playback snapshot", async () => {
		const room = await newRoom();
		const read = await chat.getRoom(room.id);
		expect(read).toEqual(room);
		// The snapshot must survive a JSON round trip unchanged — otherwise the room is not
		// self-contained.
		expect(read?.seed).toEqual(room.seed);
		expect(read?.dirty).toBe(1);
		expect(read?.serverVersion).toBe(0);
	});

	it("the list is most recent activity first", async () => {
		const first = await newRoom("First");
		const second = await newRoom("Second");
		expect((await chat.listRooms()).map((r) => r.id)).toEqual([
			second.id,
			first.id,
		]);

		await chat.appendMessage({
			roomId: first.id,
			role: "user",
			content: "Hi",
		});
		expect((await chat.listRooms()).map((r) => r.id)).toEqual([
			first.id,
			second.id,
		]);
	});

	it("the store re-checks the rename rules", async () => {
		const room = await newRoom();
		await expect(chat.renameRoom(room.id, "   ")).rejects.toThrow();
		expect((await chat.getRoom(room.id))?.title).toBe("The Night Library");

		await chat.renameRoom(room.id, "  New title  ");
		expect((await chat.getRoom(room.id))?.title).toBe("New title");
	});

	it("soft deletion isn't visible but the row stays — sync must carry that fact", async () => {
		const room = await newRoom();
		await chat.deleteRoom(room.id);

		expect(await chat.getRoom(room.id)).toBeNull();
		expect(await chat.listRooms()).toEqual([]);

		const row = await db.first<{ deleted_at: string | null; dirty: number }>(
			"SELECT deleted_at, dirty FROM chat_room WHERE id = ?",
			[room.id],
		);
		expect(row?.deleted_at).not.toBeNull();
		expect(row?.dirty).toBe(1);
	});

	it("deleting a room deletes its messages and memories in the same transaction", async () => {
		const room = await newRoom();
		await chat.appendMessage({
			roomId: room.id,
			role: "user",
			content: "Hi",
		});
		const memory = await chat.createMemory({
			roomId: room.id,
			content: "Likes cats",
		});
		const before = await db.first<{ rev_t: number; dirty: number }>(
			"SELECT rev_t, dirty FROM chat_memory WHERE id = ?",
			[memory.id],
		);

		await chat.deleteRoom(room.id);

		expect(await chat.listRecentMessages(room.id)).toEqual([]);
		expect(await chat.listMemories(room.id)).toEqual([]);

		/**
		 * Children deleted along with the room **do not raise their revision or dirty flag.** Raising
		 * them would turn one room deletion into a push of thousands of records, and that push announces
		 * nothing new.
		 */
		const after = await db.first<{
			deleted_at: string | null;
			rev_t: number;
			dirty: number;
		}>("SELECT deleted_at, rev_t, dirty FROM chat_memory WHERE id = ?", [
			memory.id,
		]);
		expect(after?.deleted_at).not.toBeNull();
		expect(after?.rev_t).toBe(before?.rev_t);
		expect(after?.dirty).toBe(before?.dirty);
	});

	/**
	 * ⚠️ **The room's fourth child** is carried along by the same rule. The list query reads the room
	 * first, so while the room's row is alive the result is an empty array anyway — hence this checks
	 * the child row's tombstone directly. Leave it out and the next sync re-uploads the characters of
	 * a deleted room as live records.
	 */
	it("deleting a room deletes its added characters in the same transaction", async () => {
		const room = await newRoom();
		const character = await chat.createCharacter({
			roomId: room.id,
			name: "Eugene",
		});
		const before = await db.first<{ rev_t: number; dirty: number }>(
			"SELECT rev_t, dirty FROM chat_character WHERE id = ?",
			[character.id],
		);

		await chat.deleteRoom(room.id);

		const after = await db.first<{
			deleted_at: string | null;
			rev_t: number;
			dirty: number;
		}>("SELECT deleted_at, rev_t, dirty FROM chat_character WHERE id = ?", [
			character.id,
		]);
		expect(after?.deleted_at).not.toBeNull();
		expect(after?.rev_t).toBe(before?.rev_t);
		expect(after?.dirty).toBe(before?.dirty);
	});

	it("a late write to a deleted room doesn't revive it", async () => {
		const room = await newRoom();
		await chat.deleteRoom(room.id);

		await chat.renameRoom(room.id, "Revive");
		await chat.touchRoom(room.id);
		const late = await chat.appendMessage({
			roomId: room.id,
			role: "assistant",
			content: "A late reply",
		});

		expect(await chat.getRoom(room.id)).toBeNull();
		// A late message inherits the room's deletion time — it does not climb up as an orphan.
		expect(late.deletedAt).not.toBeNull();
	});
});

describe("Message", () => {
	it("appending raises the room's activity time too", async () => {
		const room = await newRoom();
		const before = (await chat.getRoom(room.id))?.updatedAt;
		await chat.appendMessage({
			roomId: room.id,
			role: "user",
			content: "Hi",
		});
		expect((await chat.getRoom(room.id))?.updatedAt).not.toBe(before);
	});

	it("pages are ascending and the cursor creates no duplicates or drops", async () => {
		const room = await newRoom();
		for (let i = 0; i < 6; i++)
			await chat.appendMessage({
				roomId: room.id,
				role: "user",
				content: `m${i}`,
			});

		const page = await chat.listRecentMessages(room.id, { limit: 3 });
		expect(page.map((m) => m.content)).toEqual(["m3", "m4", "m5"]);

		const older = await chat.listRecentMessages(room.id, {
			limit: 3,
			before: page[0].id,
		});
		expect(older.map((m) => m.content)).toEqual(["m0", "m1", "m2"]);
	});

	/**
	 * ⚠️ Tombstones are filtered **before the limit is applied.** This result is the generation
	 * history window and also the screen's `hasOlder = length >= limit` check. If they were filtered
	 * after cutting, the room after `delete from here` would shrink the window and leave no way to
	 * open the earlier conversation.
	 */
	it("deleted messages don't take up page slots", async () => {
		const room = await newRoom();
		const ids: string[] = [];
		for (let i = 0; i < 10; i++)
			ids.push(
				(
					await chat.appendMessage({
						roomId: room.id,
						role: i % 2 === 0 ? "user" : "assistant",
						content: `m${i}`,
					})
				).id,
			);
		await chat.deleteFromMessage(ids[4] as string);
		const fresh = await chat.appendMessage({
			roomId: room.id,
			role: "user",
			content: "new",
		});

		const page = await chat.listRecentMessages(room.id, { limit: 4 });
		expect(page.map((m) => m.content)).toEqual(["m1", "m2", "m3", "new"]);

		const older = await chat.listRecentMessages(room.id, {
			limit: 1,
			before: fresh.id,
		});
		expect(older.map((m) => m.content)).toEqual(["m3"]);
	});

	it("the full list gives the whole conversation in ascending order for search", async () => {
		const room = await newRoom();
		for (const content of ["one", "two", "three"])
			await chat.appendMessage({ roomId: room.id, role: "user", content });
		expect((await chat.listAllMessages(room.id)).map((m) => m.content)).toEqual(
			["one", "two", "three"],
		);
	});

	it("generation metadata (down to cache accounting) survives a round trip", async () => {
		const room = await newRoom();
		const message = await chat.appendMessage({
			roomId: room.id,
			role: "assistant",
			content: "response",
			model: "anthropic/claude-sonnet-5",
			inputTokens: 7_100,
			cachedInputTokens: 5_000,
			cacheWriteInputTokens: 2_000,
			outputTokens: 250,
		});
		const [read] = await chat.listRecentMessages(room.id);
		expect(read).toEqual(message);
		expect(read.cachedInputTokens).toBe(5_000);
		// An axis with no value must be **absent as a key** — the codec tells the two apart.
		expect("incomplete" in read).toBe(false);
	});

	it("for the incomplete marker, false and absent differ", async () => {
		const room = await newRoom();
		const message = await chat.appendMessage({
			roomId: room.id,
			role: "assistant",
			content: "A cut reply",
			incomplete: true,
		});
		expect((await chat.listRecentMessages(room.id))[0].incomplete).toBe(true);

		await chat.updateMessage(message.id, {
			incomplete: false,
			content: "Complete",
		});
		const [updated] = await chat.listRecentMessages(room.id);
		expect(updated.incomplete).toBe(false);
		expect(updated.content).toBe("Complete");
	});

	it("editing deletes everything after it", async () => {
		const room = await newRoom();
		const first = await chat.appendMessage({
			roomId: room.id,
			role: "user",
			content: "Question",
		});
		await chat.appendMessage({
			roomId: room.id,
			role: "assistant",
			content: "Answer",
		});

		const result = await chat.editUserMessage(first.id, "The edited question");
		expect(result).toEqual({ applied: true, removed: 1 });
		expect((await chat.listAllMessages(room.id)).map((m) => m.content)).toEqual(
			["The edited question"],
		);
	});

	it("delete from here includes the anchor, and each tail message gets its own tombstone", async () => {
		const room = await newRoom();
		const messages = [];
		for (const content of ["one", "two", "three"])
			messages.push(
				await chat.appendMessage({ roomId: room.id, role: "user", content }),
			);

		const result = await chat.deleteFromMessage(messages[1].id);
		expect(result).toEqual({ applied: true, removed: 2 });
		expect((await chat.listAllMessages(room.id)).map((m) => m.content)).toEqual(
			["one"],
		);

		/**
		 * Unlike the room-deletion cascade. There is no parent tombstone to stand in for them, so without
		 * a marker another device would re-upload the messages it still knows about.
		 */
		const rows = await db.all<{ dirty: number }>(
			"SELECT dirty FROM chat_message WHERE id IN (?, ?)",
			[messages[1].id, messages[2].id],
		);
		expect(rows.map((row) => row.dirty)).toEqual([1, 1]);
	});

	/**
	 * Even after both roles became editable, **there are still two doors.** A mismatched call is
	 * checked again by the store — what the screen draws is not a guarantee to the store.
	 */
	it("assistant messages can't enter through the user edit door", async () => {
		const room = await newRoom();
		const reply = await chat.appendMessage({
			roomId: room.id,
			role: "assistant",
			content: "Answer",
		});
		await expect(chat.editUserMessage(reply.id, "Edit")).rejects.toThrow();
		expect(await chat.editUserMessage("missing-message", "Edit")).toEqual({
			applied: false,
			removed: 0,
		});
	});

	it("editing an assistant reply deletes everything after it", async () => {
		const room = await newRoom();
		await chat.appendMessage({
			roomId: room.id,
			role: "user",
			content: "Question",
		});
		const reply = await chat.appendMessage({
			roomId: room.id,
			role: "assistant",
			content: "Answer",
			truncated: true,
		});
		await chat.appendMessage({
			roomId: room.id,
			role: "user",
			content: "The next question",
		});

		expect(
			await chat.editAssistantMessage(reply.id, "A hand-edited answer"),
		).toEqual({ applied: true, removed: 1 });
		const rows = await chat.listAllMessages(room.id);
		expect(rows.map((row) => row.content)).toEqual([
			"Question",
			"A hand-edited answer",
		]);
		/** Even when edited by hand, that response still hit the limit and is a cut-off text. */
		expect(rows.at(-1)?.truncated).toBe(true);
	});

	it("user messages can't enter through the assistant edit door", async () => {
		const room = await newRoom();
		const said = await chat.appendMessage({
			roomId: room.id,
			role: "user",
			content: "Question",
		});
		await expect(chat.editAssistantMessage(said.id, "Edit")).rejects.toThrow();
		expect(await chat.editAssistantMessage("missing-message", "Edit")).toEqual({
			applied: false,
			removed: 0,
		});
	});
});

describe("Memory", () => {
	it("pinned first, then most recently edited", async () => {
		const room = await newRoom();
		const a = await chat.createMemory({ roomId: room.id, content: "First" });
		const b = await chat.createMemory({ roomId: room.id, content: "Second" });
		expect((await chat.listMemories(room.id)).map((m) => m.id)).toEqual([
			b.id,
			a.id,
		]);

		await chat.updateMemory(a.id, { pinned: true });
		expect((await chat.listMemories(room.id)).map((m) => m.id)).toEqual([
			a.id,
			b.id,
		]);
	});

	it("the store re-checks the content rules", async () => {
		const room = await newRoom();
		await expect(
			chat.createMemory({ roomId: room.id, content: "  " }),
		).rejects.toBeInstanceOf(ChatMemoryContentError);
	});

	it("can't create in a missing room — only this operation throws", async () => {
		await expect(
			chat.createMemory({ roomId: "missing-room", content: "Memory" }),
		).rejects.toBeInstanceOf(ChatRoomMissingError);
	});

	it("editing preserves identity (it doesn't delete and recreate)", async () => {
		const room = await newRoom();
		const memory = await chat.createMemory({
			roomId: room.id,
			content: "Cat",
		});
		await chat.updateMemory(memory.id, { content: "Black cat" });
		const [read] = await chat.listMemories(room.id);
		expect(read.id).toBe(memory.id);
		expect(read.createdAt).toBe(memory.createdAt);
		expect(read.content).toBe("Black cat");
	});

	it("deletion is soft and idempotent", async () => {
		const room = await newRoom();
		const memory = await chat.createMemory({
			roomId: room.id,
			content: "Memory",
		});
		await chat.deleteMemory(memory.id);
		await chat.deleteMemory(memory.id);
		expect(await chat.listMemories(room.id)).toEqual([]);
		const row = await db.first<{ deleted_at: string | null }>(
			"SELECT deleted_at FROM chat_memory WHERE id = ?",
			[memory.id],
		);
		expect(row?.deleted_at).not.toBeNull();
	});
});

/**
 * Routing-friendly keys — **the same behaviour matrix** as the web store.
 *
 * The two apps must agree on this rule because one account moves between two devices. If only one
 * side skips the lazy issuance, conversations continued on that device get a new key every turn,
 * and the difference shows no symptom on screen.
 */
describe("User note", () => {
	it("a created room has no key — no note attached is the starting state", async () => {
		const room = await newRoom();
		const stored = await chat.getRoom(room.id);
		expect(stored && "userNote" in stored).toBe(false);
	});

	/**
	 * ⚠️ **Without a column, sync silently drops this axis** (v19). A note written on the web falls to
	 * no value the moment it arrives on this device, and this device's next push uploads a version
	 * without the note.
	 */
	it("the written text round-trips through SQLite — multiple lines as is", async () => {
		const room = await newRoom();
		await chat.setRoomUserNote(
			room.id,
			"  Short descriptions.\nMostly dialogue.  ",
		);
		expect((await chat.getRoom(room.id))?.userNote).toBe(
			"Short descriptions.\nMostly dialogue.",
		);
	});

	/**
	 * The state of "cleared" must be **only the absence of the key.** It uses the same function as the
	 * web, so the record shape is the same in both apps and a round trip between two devices converges
	 * to the same result.
	 */
	it.each([
		null,
		"",
		"   ",
	])("saving as %j makes the column NULL", async (value) => {
		const room = await newRoom();
		await chat.setRoomUserNote(room.id, "The old value");
		await chat.setRoomUserNote(room.id, value);

		const stored = await chat.getRoom(room.id);
		expect(stored && "userNote" in stored).toBe(false);
		const row = await db.first<{ user_note: string | null }>(
			"SELECT user_note FROM chat_room WHERE id = ?",
			[room.id],
		);
		expect(row?.user_note).toBeNull();
	});

	/** The screen already blocks this, but the store checks again — there is more than one caller. */
	it("over the limit it throws and writes nothing", async () => {
		const room = await newRoom();
		const before = await chat.getRoom(room.id);
		await expect(
			chat.setRoomUserNote(room.id, "a".repeat(CHAT_USER_NOTE_MAX_LENGTH + 1)),
		).rejects.toBeInstanceOf(ChatUserNoteError);
		expect(await chat.getRoom(room.id)).toEqual(before);
	});

	/** A row stored before this axis existed — its column was `NULL` then. */
	it("old rows with a NULL column read as records without the key", async () => {
		const room = await newRoom();
		await chat.setRoomUserNote(room.id, "A written value");
		await db.run("UPDATE chat_room SET user_note = NULL WHERE id = ?", [
			room.id,
		]);

		const stored = await chat.getRoom(room.id);
		expect(stored && "userNote" in stored).toBe(false);
	});

	it("does nothing to a deleted room", async () => {
		const room = await newRoom();
		await chat.deleteRoom(room.id);
		await chat.setRoomUserNote(room.id, "A note that arrived late");
		expect(await chat.getRoom(room.id)).toBeNull();
	});
});

describe("routing session", () => {
	/** Mimics a row stored before this axis existed — its column was `NULL` then. */
	const dropRoutingSession = (id: string) =>
		db.run("UPDATE chat_room SET routing_session_id = NULL WHERE id = ?", [id]);

	it("a new room is born with a value, not derived from the room id", async () => {
		const room = await newRoom();
		expect(room.routingSessionId).toBeTruthy();
		expect(room.routingSessionId).not.toBe(room.id);
		expect((await chat.getRoom(room.id))?.routingSessionId).toBe(
			room.routingSessionId,
		);
	});

	it("different rooms get different values", async () => {
		const [a, b] = [await newRoom("First"), await newRoom("Second")];
		expect(a.routingSessionId).not.toBe(b.routingSessionId);
	});

	it("two turns in the same room get the same value", async () => {
		const room = await newRoom();
		expect(await chat.ensureRoomRoutingSession(room.id)).toBe(
			room.routingSessionId,
		);
		expect(await chat.ensureRoomRoutingSession(room.id)).toBe(
			room.routingSessionId,
		);
	});

	it("a room without a value gets one issued once and persists it", async () => {
		const room = await newRoom();
		await dropRoutingSession(room.id);
		expect((await chat.getRoom(room.id))?.routingSessionId).toBeUndefined();

		const issued = await chat.ensureRoomRoutingSession(room.id);
		expect(issued).toBeTruthy();
		expect((await chat.getRoom(room.id))?.routingSessionId).toBe(issued);
		expect(await chat.ensureRoomRoutingSession(room.id)).toBe(issued);
	});

	/** Issuance is not conversation activity — pushing it up would move an old conversation to the top of the list. */
	it("issuing doesn't push the room's activity time", async () => {
		const room = await newRoom();
		await dropRoutingSession(room.id);
		await chat.ensureRoomRoutingSession(room.id);
		const after = await chat.getRoom(room.id);
		expect(after?.updatedAt).toBe(room.updatedAt);
		expect(after?.dirty).toBe(1);
	});

	it("doesn't issue to a deleted room", async () => {
		const room = await newRoom();
		await chat.deleteRoom(room.id);
		expect(await chat.ensureRoomRoutingSession(room.id)).toBeNull();
		expect(await chat.ensureRoomRoutingSession("missing-room")).toBeNull();
	});
});
