import type { ChatSeed, ChatStore } from "@rowcat/chat";
import {
	CHAT_PERSONA_NAME_MAX_LENGTH,
	ChatPersonaNameError,
	effectiveChatPersona,
	personaSnapshotOf,
} from "@rowcat/chat";
import { StoryChatSeedDto } from "@rowcat/contracts/chat";
import { compareRev } from "@rowcat/sync";
import { afterEach, describe, expect, it } from "vitest";
import {
	activateLocalDbScope,
	resetLocalDbScope,
} from "#/lib/local-data/db.ts";
import { createChatStore } from "./store.ts";

/**
 * Persona library and per-room overrides, on real IndexedDB. Types alone do not establish three
 * things:
 * - account isolation: Alice's library does not appear in Bob's list
 * - independence: editing or deleting the library does not disturb a room that already chose a
 *   persona
 * - revision: one edit is one revision (two would expose the intermediate state) The middle one
 *   is the feature's product decision: a room holds a value, not a reference. Deleting a library
 *   entry and checking that the room is unchanged is the only way to verify it.
 */

const seed = (persona: ChatSeed["persona"] = null): ChatSeed =>
	StoryChatSeedDto.parse({
		version: 1,
		storyId: "story-1",
		title: "Test story",
		adult: false,
		promptProtected: false,
		persona,
	});

let sequence = 0;
const nextViewer = (label: string): string => `${label}-${++sequence}`;

/**
 * Opens the member scope and creates the store, in the same order the app uses right after login.
 */
const open = (viewerId: string): ChatStore =>
	createChatStore(activateLocalDbScope(viewerId));

afterEach(() => {
	resetLocalDbScope();
});

describe("library", () => {
	it("creates and reads back", async () => {
		const store = open(nextViewer("alice"));
		const created = await store.createPersona({
			name: "Jihoon",
			description: "A college student.",
		});
		expect(await store.getPersona(created.id)).toEqual(created);
		expect(await store.listPersonas()).toEqual([created]);
	});

	it("created without a description: a role with only a name is complete", async () => {
		const store = open(nextViewer("alice"));
		const created = await store.createPersona({ name: "Rei" });
		expect(created.description).toBe("");
	});

	/**
	 * The store does not trust the screen. This operation is called from several places (web form,
	 * mobile, tests). A rule-breaking value written here would sync to other devices and be rejected
	 * by the receiving decoder, so that device would never get the persona.
	 */
	it("a name that breaks the rules is not saved", async () => {
		const store = open(nextViewer("alice"));
		await expect(store.createPersona({ name: "   " })).rejects.toBeInstanceOf(
			ChatPersonaNameError,
		);
		await expect(
			store.createPersona({
				name: "A".repeat(CHAT_PERSONA_NAME_MAX_LENGTH + 1),
			}),
		).rejects.toBeInstanceOf(ChatPersonaNameError);
		expect(await store.listPersonas()).toEqual([]);
	});

	it("an edit keeps identity and issues one revision", async () => {
		const store = open(nextViewer("alice"));
		const created = await store.createPersona({ name: "Jihoon" });
		await store.updatePersona(created.id, { name: "Jihoon (edited)" });

		const updated = await store.getPersona(created.id);
		expect(updated?.id).toBe(created.id);
		expect(updated?.name).toBe("Jihoon (edited)");
		expect(updated?.createdAt).toBe(created.createdAt);
		expect(updated?.serverVersion).toBe(created.serverVersion);
		expect(updated?.dirty).toBe(1);
		if (updated)
			expect(compareRev(updated.rev, created.rev)).toBeGreaterThan(0);
	});

	it("deletion is soft and idempotent", async () => {
		const store = open(nextViewer("alice"));
		const created = await store.createPersona({ name: "Jihoon" });
		await store.deletePersona(created.id);
		expect(await store.getPersona(created.id)).toBeNull();
		expect(await store.listPersonas()).toEqual([]);
		/* A second call must not fail: deleting the same line in two tabs really happens. */
		await expect(store.deletePersona(created.id)).resolves.toBeUndefined();
	});

	it("a deleted role does not revive", async () => {
		const store = open(nextViewer("alice"));
		const created = await store.createPersona({ name: "Jihoon" });
		await store.deletePersona(created.id);
		await store.updatePersona(created.id, { name: "Revive" });
		expect(await store.getPersona(created.id)).toBeNull();
	});

	it("the list is in recent-edit order", async () => {
		const store = open(nextViewer("alice"));
		const first = await store.createPersona({ name: "Earlier" });
		const second = await store.createPersona({ name: "Later" });
		await store.updatePersona(first.id, { description: "Touched again." });

		expect((await store.listPersonas()).map((row) => row.name)).toEqual([
			"Earlier",
			"Later",
		]);
		expect(second.id).not.toBe(first.id);
	});

	/**
	 * Member isolation is enforced by the database name. The check exists anyway because the failure
	 * is silent: another member's persona shows in my list and the screen looks normal.
	 */
	it("another member's library does not mix in", async () => {
		const alice = nextViewer("alice");
		const bob = nextViewer("bob");

		const aliceStore = open(alice);
		await aliceStore.createPersona({ name: "Jihoon" });
		resetLocalDbScope();

		const bobStore = open(bob);
		expect(await bobStore.listPersonas()).toEqual([]);
	});
});

describe("room override", () => {
	const roomWith = async (store: ChatStore, storyPersona = null) =>
		store.createRoom({ originStoryId: "story-1", seed: seed(storyPersona) });

	it("the chosen value lands on the room and becomes the effective persona", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);
		const persona = await store.createPersona({
			name: "Jihoon",
			description: "A college student.",
		});

		await store.setRoomPersona(room.id, personaSnapshotOf(persona));

		const updated = await store.getRoom(room.id);
		expect(updated?.persona).toEqual({
			name: "Jihoon",
			description: "A college student.",
		});
		if (updated)
			expect(effectiveChatPersona(updated)).toEqual({
				name: "Jihoon",
				description: "A college student.",
			});
	});

	/**
	 * The cleared state is the absence of the key (applyRoomPersona). Storing null would give the same
	 * fact two shapes, which only the idempotency check of a two-device round trip exposes. `null`
	 * clears the override; it does not copy the inherited value.
	 */
	it("`null` clears the override; it does not copy the parent value", async () => {
		const store = open(nextViewer("alice"));
		const room = await store.createRoom({
			originStoryId: "story-1",
			seed: seed({ name: "Visitor", description: "" }),
			persona: { name: "Jihoon", description: "" },
		});

		await store.setRoomPersona(room.id, null);

		const updated = await store.getRoom(room.id);
		expect(updated?.persona).toBeUndefined();
		if (updated)
			expect(effectiveChatPersona(updated)).toEqual({
				name: "Visitor",
				description: "",
			});
	});

	it("one edit is one revision and raises the activity time", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);

		await store.setRoomPersona(room.id, { name: "Jihoon", description: "" });

		const updated = await store.getRoom(room.id);
		expect(updated?.dirty).toBe(1);
		if (updated) {
			expect(compareRev(updated.rev, room.rev)).toBeGreaterThan(0);
			expect(updated.updatedAt >= room.updatedAt).toBe(true);
		}
	});

	it("the store validates the value again", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);
		await expect(
			store.setRoomPersona(room.id, { name: "  ", description: "" }),
		).rejects.toBeInstanceOf(ChatPersonaNameError);
		expect((await store.getRoom(room.id))?.persona).toBeUndefined();
	});

	it("a deleted room does not revive", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);
		await store.deleteRoom(room.id);
		await store.setRoomPersona(room.id, { name: "Jihoon", description: "" });
		expect(await store.getRoom(room.id)).toBeNull();
	});
});

describe("library and room independence", () => {
	it("editing the library leaves rooms that already chose it unchanged", async () => {
		const store = open(nextViewer("alice"));
		const room = await store.createRoom({
			originStoryId: "story-1",
			seed: seed(),
		});
		const persona = await store.createPersona({
			name: "Jihoon",
			description: "A college student.",
		});
		await store.setRoomPersona(room.id, personaSnapshotOf(persona));

		await store.updatePersona(persona.id, {
			name: "Jihoon (edited)",
			description: "A graduate student.",
		});

		expect((await store.getRoom(room.id))?.persona).toEqual({
			name: "Jihoon",
			description: "A college student.",
		});
	});

	it("choosing again brings in the new value then", async () => {
		const store = open(nextViewer("alice"));
		const room = await store.createRoom({
			originStoryId: "story-1",
			seed: seed(),
		});
		const persona = await store.createPersona({ name: "Jihoon" });
		await store.setRoomPersona(room.id, personaSnapshotOf(persona));
		await store.updatePersona(persona.id, { name: "Jihoon (edited)" });

		const refreshed = await store.getPersona(persona.id);
		expect(refreshed).not.toBeNull();
		if (refreshed)
			await store.setRoomPersona(room.id, personaSnapshotOf(refreshed));

		expect((await store.getRoom(room.id))?.persona?.name).toBe(
			"Jihoon (edited)",
		);
	});

	it("deleting from the library keeps the room in that role", async () => {
		const store = open(nextViewer("alice"));
		const persona = await store.createPersona({
			name: "Jihoon",
			description: "A college student.",
		});
		const room = await store.createRoom({
			originStoryId: "story-1",
			seed: seed(),
			persona: personaSnapshotOf(persona),
		});

		await store.deletePersona(persona.id);

		expect(await store.listPersonas()).toEqual([]);
		expect((await store.getRoom(room.id))?.persona).toEqual({
			name: "Jihoon",
			description: "A college student.",
		});
	});

	it("deleting the room keeps the library row; the library is not a child of the room", async () => {
		const store = open(nextViewer("alice"));
		const persona = await store.createPersona({ name: "Jihoon" });
		const room = await store.createRoom({
			originStoryId: "story-1",
			seed: seed(),
			persona: personaSnapshotOf(persona),
		});

		await store.deleteRoom(room.id);

		expect((await store.listPersonas()).map((row) => row.id)).toEqual([
			persona.id,
		]);
	});
});

describe("stored speakers", () => {
	it("changing the role does not change the speaker of old utterances", async () => {
		const store = open(nextViewer("alice"));
		const room = await store.createRoom({
			originStoryId: "story-1",
			seed: seed(),
			persona: { name: "Jihoon", description: "" },
		});
		/*
		 * The conversation session decides the speaker (createChatConversation); the store writes the
		 * value it receives as-is. This test checks only that a saved speaker is never rewritten.
		 */
		await store.appendMessage({
			roomId: room.id,
			role: "user",
			content: "hello",
			speaker: "Jihoon",
		});

		await store.setRoomPersona(room.id, { name: "Rei", description: "" });
		await store.appendMessage({
			roomId: room.id,
			role: "user",
			content: "Let's move on",
			speaker: "Rei",
		});

		const messages = await store.listRecentMessages(room.id);
		expect(messages.map((message) => message.speaker)).toEqual([
			"Jihoon",
			"Rei",
		]);
	});
});
