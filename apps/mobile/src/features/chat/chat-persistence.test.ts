import type { ChatStore } from "@rowcat/chat";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LocalScopeController } from "../../lib/local-data/activation.ts";
import { seed } from "../../test/fixtures.ts";
import {
	createMemorySecureStorage,
	createTempDirectory,
	createTestScopeController,
} from "../../test/sqlite-node.ts";
import { chatPersonaKey, createChatConversation } from "./chat-conversation.ts";

/**
 * Conversations outlive the process. This checks not that React state survives re-render but that
 * closing the whole scope (the connection drops) and reopening yields the same conversation from
 * the same file. A real file in a temp directory makes that round trip happen
 * (`src/test/sqlite-node.ts`); `:memory:` could not express it. Unlike killing the app in a
 * simulator the process stays alive, which is independent of the SQLite file's lifetime.
 */

let temp: ReturnType<typeof createTempDirectory>;
let controller: LocalScopeController;

const storage = createMemorySecureStorage();

beforeEach(() => {
	temp = createTempDirectory();
	controller = createTestScopeController(temp.path, storage);
});

afterEach(async () => {
	await controller.release();
	temp.dispose();
});

const converse = async (chat: ChatStore, title: string) => {
	const room = await chat.createRoom({
		originStoryId: "story-1",
		seed: seed(title),
	});
	const session = createChatConversation({
		room,
		store: chat,
		token: chat,
		preferences: null,
	});
	await session.appendUserMessage("Hi");
	await session.appendAssistantMessage({
		role: "assistant",
		content: "Nice to meet you.",
	});
	return room;
};

describe("conversations remain after closing and reopening the app", () => {
	it("closing and reopening the connection gives the same room and messages", async () => {
		const first = await controller.activate("alice");
		const room = await converse(first.stores.chat, "The Night Library");

		// Same point as the process dying: the connection drops.
		await controller.release();

		const reopened = await controller.activate("alice");
		const chat = reopened.stores.chat;

		expect((await chat.getRoom(room.id))?.title).toBe("The Night Library");
		expect(
			(await chat.listAllMessages(room.id)).map((m) => [m.role, m.content]),
		).toEqual([
			["user", "Hi"],
			["assistant", "Nice to meet you."],
		]);
	});

	// A reopened connection is a new instance. That is the basis of the ownership check
	// (`@rowcat/chat`'s `ownsSession`), so an old closure's write cannot pass after `Alice → sign out
	// → Alice`.
	it("the reopened store is a different instance — old references don't revive", async () => {
		const first = await controller.activate("alice");
		const before = first.stores.chat;
		await controller.release();
		const after = (await controller.activate("alice")).stores.chat;

		expect(after).not.toBe(before);
	});

	it("the room is found again from the address alone — why screens don't carry objects", async () => {
		const first = await controller.activate("alice");
		const room = await converse(first.stores.chat, "A room found again");
		const roomId = room.id;
		await controller.release();

		// Same as arriving directly at `/chat/<id>`: all we hold is one string.
		const chat = (await controller.activate("alice")).stores.chat;
		expect((await chat.getRoom(roomId))?.id).toBe(roomId);
	});
});

describe("account isolation", () => {
	// The core correctness requirement: Bob opening Alice's room address must find no room, and none
	// of Alice's content may show for a frame. The decision is baked into per-member files, so this
	// holds before the screen does anything.
	it("Bob can't open Alice's room", async () => {
		const alice = await controller.activate("alice");
		const room = await converse(alice.stores.chat, "Alice's conversation");

		const bob = await controller.activate("bob");

		expect(await bob.stores.chat.getRoom(room.id)).toBeNull();
		expect(await bob.stores.chat.listAllMessages(room.id)).toEqual([]);
		expect(await bob.stores.chat.listRooms()).toEqual([]);
	});

	it("coming back as Alice, that conversation is still there", async () => {
		const alice = await controller.activate("alice");
		const room = await converse(alice.stores.chat, "Alice's conversation");
		await controller.activate("bob");

		const back = await controller.activate("alice");

		expect((await back.stores.chat.getRoom(room.id))?.title).toBe(
			"Alice's conversation",
		);
		expect(await back.stores.chat.listAllMessages(room.id)).toHaveLength(2);
	});

	// Sign-out closes access without giving up ownership, so data is kept and the same member signing
	// in again opens the same named file.
	it("signing out doesn't erase conversations", async () => {
		const alice = await controller.activate("alice");
		const room = await converse(alice.stores.chat, "Not erased");
		await controller.release();

		const back = await controller.activate("alice");
		expect(await back.stores.chat.getRoom(room.id)).not.toBeNull();
	});
});

describe("write signals", () => {
	// Conversation writes pass through the existing signal boundary unchanged. That is why the screen
	// never calls sync directly (no `autoSync.requestSync()` in this slice); if the wiring breaks,
	// this device's conversations do not upload until the next lifecycle signal.
	it("the user line and the confirmed reply each emit a signal", async () => {
		const scope = await controller.activate("alice");
		const room = await scope.stores.chat.createRoom({
			originStoryId: "story-1",
			seed: seed("signal"),
		});
		const session = createChatConversation({
			room,
			store: scope.stores.chat,
			token: scope.stores.chat,
			preferences: null,
		});

		let signals = 0;
		const stop = scope.stores.mutations.subscribe(() => {
			signals += 1;
		});

		await session.appendUserMessage("Hi");
		await session.appendAssistantMessage({
			role: "assistant",
			content: "Nice to meet you.",
		});

		expect(signals).toBe(2);
		stop();
	});

	it("reading history emits no signal", async () => {
		const scope = await controller.activate("alice");
		const room = await converse(scope.stores.chat, "Views");
		const session = createChatConversation({
			room,
			store: scope.stores.chat,
			token: scope.stores.chat,
			preferences: null,
		});

		let signals = 0;
		const stop = scope.stores.mutations.subscribe(() => {
			signals += 1;
		});

		await session.loadHistory();
		await session.loadMemories();

		expect(signals).toBe(0);
		stop();
	});
});

/**
 * The persona axis of the execution identity, same rule as web's `personaKey` in
 * `use-chat-generation.ts`. The screen memoizes `{ store, personaKey }` on this key: if other room
 * updates (activity time) move it, generation cuts itself every turn; if a persona change does not
 * move it, a response built under the old persona is saved into the new speaker's conversation.
 */
describe("the role axis of the execution identity", () => {
	it("splits only when the role changes, and doesn't waver with activity time", async () => {
		const { stores } = await controller.activate("alice");
		const chat = stores.chat;
		const room = await chat.createRoom({
			originStoryId: "story-1",
			seed: seed("The Night Library"),
		});
		const before = chatPersonaKey(await chat.getRoom(room.id));

		await chat.touchRoom(room.id);
		expect(chatPersonaKey(await chat.getRoom(room.id))).toBe(before);

		await chat.setRoomPersona(room.id, { name: "Ray", description: "" });
		const renamed = chatPersonaKey(await chat.getRoom(room.id));
		expect(renamed).not.toBe(before);

		await chat.setRoomPersona(room.id, {
			name: "Ray",
			description: "Detective",
		});
		expect(chatPersonaKey(await chat.getRoom(room.id))).not.toBe(renamed);
	});

	it("the session uses the token the screen froze as is — it doesn't fold into one store", async () => {
		const { stores } = await controller.activate("alice");
		const room = await stores.chat.createRoom({
			originStoryId: "story-1",
			seed: seed("The Night Library"),
		});
		const token = { store: stores.chat, personaKey: chatPersonaKey(room) };
		const session = createChatConversation({
			room,
			store: stores.chat,
			token,
			preferences: null,
		});
		expect(session.token).toBe(token);
	});
});
