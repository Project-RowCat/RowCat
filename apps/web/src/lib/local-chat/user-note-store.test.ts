import type { ChatStore } from "@rowcat/chat";
import { CHAT_USER_NOTE_MAX_LENGTH, ChatUserNoteError } from "@rowcat/chat";
import { StoryChatSeedDto } from "@rowcat/contracts/chat";
import { compareRev } from "@rowcat/sync";
import { afterEach, describe, expect, it } from "vitest";
import {
	activateLocalDbScope,
	resetLocalDbScope,
} from "#/lib/local-data/db.ts";
import { createChatStore } from "./store.ts";

/**
 * Tests room user notes against real IndexedDB. Types alone cannot show that a written note
 * persists, that clearing it deletes the key itself, or that the store enforces the cap instead of
 * trusting the UI.
 *
 * The key-deletion case is this slice's product decision: 'no note' must have one representation so
 * two-device round trips stay idempotent. Only opening the stored object can verify that.
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

describe("a room's user note", () => {
	it("a new room has no key: no note is the starting state", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);
		const stored = await store.getRoom(room.id);
		expect(stored && "userNote" in stored).toBe(false);
	});

	it("the written text lands on the room with only surrounding whitespace trimmed", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);

		await store.setRoomUserNote(
			room.id,
			"  Keep descriptions short.\nFocus on dialogue.  ",
		);

		expect((await store.getRoom(room.id))?.userNote).toBe(
			"Keep descriptions short.\nFocus on dialogue.",
		);
	});

	/**
	 * The cleared state must be represented only by the absence of the key. An empty string would make
	 * rooms written before this field existed differ in shape from rooms cleared now, and the
	 * difference would only show in whether the encoder emits the key.
	 */
	it.each([null, "", "   "])("saving %j removes the key", async (value) => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);

		await store.setRoomUserNote(room.id, "Old value");
		await store.setRoomUserNote(room.id, value);

		const stored = await store.getRoom(room.id);
		expect(stored && "userNote" in stored).toBe(false);
	});

	/**
	 * The UI already blocks this, but the store re-checks: there are several callers (web, mobile,
	 * tests), and an over-cap note consumes that room's prompt on every turn.
	 */
	it("past the cap it throws and writes nothing", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);
		const before = await store.getRoom(room.id);

		await expect(
			store.setRoomUserNote(room.id, "A".repeat(CHAT_USER_NOTE_MAX_LENGTH + 1)),
		).rejects.toBeInstanceOf(ChatUserNoteError);

		expect(await store.getRoom(room.id)).toEqual(before);
	});

	it("one edit is one revision", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);

		await store.setRoomUserNote(room.id, "First version");
		const first = await store.getRoom(room.id);
		await store.setRoomUserNote(room.id, "Second version");
		const second = await store.getRoom(room.id);

		expect(first).toBeTruthy();
		expect(second).toBeTruthy();
		if (!first || !second) return;
		expect(compareRev(second.rev, first.rev)).toBeGreaterThan(0);
		expect(second.dirty).toBe(1);
	});

	/**
	 * A late mutation that overwrites the tombstone would resurrect a deleted conversation. Same rule
	 * as for roles and narration style.
	 */
	it("does nothing for a deleted room", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);

		await store.deleteRoom(room.id);
		await store.setRoomUserNote(room.id, "Late note");

		expect(await store.getRoom(room.id)).toBeNull();
	});
});
