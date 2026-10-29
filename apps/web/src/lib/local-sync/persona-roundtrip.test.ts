import type { ChatSeed } from "@rowcat/chat";
import { effectiveChatPersona, personaSnapshotOf } from "@rowcat/chat";
import { CHAT_SEED_VERSION } from "@rowcat/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
	converge,
	createDevice,
	type Device,
	FakeSyncServer,
} from "#/test/sync-devices.ts";

/**
 * Two-device round trip for personas. It also checks that the library copy and the room copy are
 * independent.
 *
 * This file exists because the slice must prove, by value, that it added one type and one optional
 * field:
 * - chat.persona: a new record type. An unaware client ignores it and advances only its cursor.
 * - chat.room.persona: an optional field. Payloads without it still apply.
 *
 * The most important property is in the last group. Deleting a library entry does not break
 * conversations that used that role, and they stay open on other devices too. The room holds a
 * value, not a reference. With a reference, the moment the deletion propagated, the room would lose
 * its speaker.
 */

const seed = (
	title: string,
	persona: ChatSeed["persona"] = null,
): ChatSeed => ({
	version: CHAT_SEED_VERSION,
	storyId: "story-1",
	title,
	tagline: "",
	adult: false,
	promptProtected: false,
	scenario: "Scenario",
	firstScene: "",
	playGuide: "",
	persona,
	characters: [],
	lore: [],
	startScenes: [],
	sceneImages: [],
});

let devices: Device[] = [];
const spawn = (server: FakeSyncServer, name: string): Device => {
	const device = createDevice(name, server);
	devices.push(device);
	return device;
};

afterEach(() => {
	for (const device of devices) device.close();
	devices = [];
});

describe("library propagation", () => {
	it("a persona A made arrives at B as is", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");

		const created = await a.chat.createPersona({
			name: "Jihoon",
			description: "A college student. Likes mystery novels.",
		});
		await converge(a, b);

		const mirrored = await b.chat.listPersonas();
		expect(mirrored).toHaveLength(1);
		expect(mirrored[0]).toMatchObject({
			id: created.id,
			name: "Jihoon",
			description: "A college student. Likes mystery novels.",
		});
	});

	it("edits converge", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");

		const created = await a.chat.createPersona({ name: "Jihoon" });
		await converge(a, b);

		await b.chat.updatePersona(created.id, { name: "Jihoon (edited)" });
		await converge(a, b);

		expect((await a.chat.getPersona(created.id))?.name).toBe("Jihoon (edited)");
	});

	it("deletion propagates and nothing revives", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");

		const created = await a.chat.createPersona({ name: "Rei" });
		await converge(a, b);

		await a.chat.deletePersona(created.id);
		await converge(a, b);
		expect(await b.chat.listPersonas()).toEqual([]);

		/* Even after another round, B does not revive an entry it knew about. */
		await converge(a, b);
		expect(await a.chat.listPersonas()).toEqual([]);
		expect(await b.chat.listPersonas()).toEqual([]);
	});

	it("concurrent edits converge deterministically to one version", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");

		const created = await a.chat.createPersona({ name: "Jihoon" });
		await converge(a, b);

		await a.chat.updatePersona(created.id, {
			description: "Description written by A.",
		});
		await b.chat.updatePersona(created.id, {
			description: "Description written by B.",
		});
		await converge(a, b);
		await converge(a, b);

		const left = await a.chat.getPersona(created.id);
		const right = await b.chat.getPersona(created.id);
		expect(left?.description).toBe(right?.description);
		/* Values do not blend. One side wins as a whole, since there is no text CRDT. */
		expect([
			"Description written by A.",
			"Description written by B.",
		]).toContain(left?.description);
	});
});

describe("room override propagation", () => {
	it("the role A chose arrives in B's same room", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");

		const room = await a.chat.createRoom({
			originStoryId: null,
			seed: seed("Role conversation"),
		});
		const persona = await a.chat.createPersona({
			name: "Jihoon",
			description: "A college student.",
		});
		await a.chat.setRoomPersona(room.id, personaSnapshotOf(persona));
		await converge(a, b);

		const mirrored = await b.chat.getRoom(room.id);
		expect(mirrored?.persona).toEqual({
			name: "Jihoon",
			description: "A college student.",
		});
	});

	it("a role pinned when the room was created arrives too", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");

		const room = await a.chat.createRoom({
			originStoryId: null,
			seed: seed("Role conversation"),
			persona: { name: "Rei", description: "" },
		});
		await converge(a, b);

		expect((await b.chat.getRoom(room.id))?.persona).toEqual({
			name: "Rei",
			description: "",
		});
	});

	it("clearing the override returns to the story's suggestion and that propagates", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");

		const room = await a.chat.createRoom({
			originStoryId: null,
			seed: seed("Role conversation", { name: "Visitor", description: "" }),
			persona: { name: "Jihoon", description: "" },
		});
		await converge(a, b);

		await a.chat.setRoomPersona(room.id, null);
		await converge(a, b);

		const mirrored = await b.chat.getRoom(room.id);
		expect(mirrored).not.toBeNull();
		/* A cleared state is represented by the absence of the key (see applyRoomPersona). */
		expect(mirrored?.persona).toBeUndefined();
		if (mirrored)
			expect(effectiveChatPersona(mirrored)).toEqual({
				name: "Visitor",
				description: "",
			});
	});
});

describe("the library and rooms do not hold each other", () => {
	it("deleting a library row leaves conversations in that role unchanged on both devices", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");

		const persona = await a.chat.createPersona({
			name: "Jihoon",
			description: "A college student.",
		});
		const room = await a.chat.createRoom({
			originStoryId: null,
			seed: seed("Role conversation"),
			persona: personaSnapshotOf(persona),
		});
		await converge(a, b);

		await a.chat.deletePersona(persona.id);
		await converge(a, b);

		expect(await b.chat.listPersonas()).toEqual([]);
		/* The room still keeps its own copy. With a reference, the speaker would vanish here. */
		for (const device of [a, b])
			expect((await device.chat.getRoom(room.id))?.persona).toEqual({
				name: "Jihoon",
				description: "A college student.",
			});
	});

	it("editing a library row does not change rooms that already chose it", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");

		const persona = await a.chat.createPersona({ name: "Jihoon" });
		const room = await a.chat.createRoom({
			originStoryId: null,
			seed: seed("Role conversation"),
			persona: personaSnapshotOf(persona),
		});
		await converge(a, b);

		await b.chat.updatePersona(persona.id, { name: "Jihoon (edited)" });
		await converge(a, b);

		expect((await a.chat.getPersona(persona.id))?.name).toBe("Jihoon (edited)");
		/*
		 * The conversation is unchanged. A conversation the user did not touch must not change silently.
		 */
		expect((await a.chat.getRoom(room.id))?.persona?.name).toBe("Jihoon");
	});

	it("deleting a room keeps the library row", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");

		const persona = await a.chat.createPersona({ name: "Jihoon" });
		const room = await a.chat.createRoom({
			originStoryId: null,
			seed: seed("Role conversation"),
			persona: personaSnapshotOf(persona),
		});
		await converge(a, b);

		await a.chat.deleteRoom(room.id);
		await converge(a, b);

		expect(await b.chat.getRoom(room.id)).toBeNull();
		/*
		 * The room tombstone's cascade does not scan this table, because the library is not a child of
		 * the room.
		 */
		expect((await b.chat.listPersonas()).map((row) => row.id)).toEqual([
			persona.id,
		]);
	});
});
