import type { ChatSeed } from "@rowcat/chat";
import { CHAT_SEED_VERSION } from "@rowcat/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
	converge,
	createDevice,
	type Device,
	FakeSyncServer,
} from "#/test/sync-devices.ts";

/**
 * Two-device round trip for memory.
 *
 * This lives in its own file because the slice must prove it added only one type to the protocol.
 * roundtrip.test.ts guards convergence for rooms, messages, and drafts. Here the new type is
 * checked to inherit those rules: propagation of create, edit, pin, and delete; concurrent edits;
 * delete-versus-edit conflicts; and that a client meeting an unknown type does not stop.
 *
 * The last item is this slice's compatibility claim itself. The server has no type vocabulary, and
 * an old client that does not know chat.memory ignores those records and advances only its cursor.
 * So neither SYNC_PROTOCOL_VERSION nor the envelope version is bumped.
 */

const seed = (title: string): ChatSeed => ({
	version: CHAT_SEED_VERSION,
	storyId: "story-1",
	title,
	tagline: "",
	adult: false,
	promptProtected: false,
	scenario: "Scenario",
	firstScene: "",
	playGuide: "",
	persona: null,
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

/**
 * Sets up one room on both devices so they agree. The shared starting point for the memory tests.
 */
const sharedRoom = async (a: Device, b: Device): Promise<string> => {
	const room = await a.chat.createRoom({
		originStoryId: null,
		seed: seed("Memory conversation"),
	});
	await converge(a, b);
	return room.id;
};

describe("memory propagation", () => {
	it("a memory A made arrives at B as is", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const roomId = await sharedRoom(a, b);

		const created = await a.chat.createMemory({
			roomId,
			content: "The persona is left-handed.",
		});
		await converge(a, b);

		const mirrored = await b.chat.listMemories(roomId);
		expect(mirrored).toHaveLength(1);
		expect(mirrored[0]).toMatchObject({
			id: created.id,
			roomId,
			content: "The persona is left-handed.",
			pinned: false,
		});
		// Received records have nothing to send back, so dirty must be 0.
		expect(mirrored[0].dirty).toBe(0);
	});

	it("a content edit crosses over keeping its identity", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const roomId = await sharedRoom(a, b);
		const created = await a.chat.createMemory({ roomId, content: "First" });
		await converge(a, b);

		await a.chat.updateMemory(created.id, { content: "Edited" });
		await converge(a, b);

		const mirrored = await b.chat.listMemories(roomId);
		expect(mirrored).toHaveLength(1);
		expect(mirrored[0].id).toBe(created.id);
		expect(mirrored[0].content).toBe("Edited");
	});

	it("pinned state crosses over", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const roomId = await sharedRoom(a, b);
		const created = await a.chat.createMemory({ roomId, content: "Memory" });
		await converge(a, b);

		await a.chat.updateMemory(created.id, { pinned: true });
		await converge(a, b);
		expect((await b.chat.listMemories(roomId))[0].pinned).toBe(true);

		await a.chat.updateMemory(created.id, { pinned: false });
		await converge(a, b);
		expect((await b.chat.listMemories(roomId))[0].pinned).toBe(false);
	});

	it("deletion crosses over; nothing revives", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const roomId = await sharedRoom(a, b);
		const created = await a.chat.createMemory({ roomId, content: "Memory" });
		await converge(a, b);
		expect(await b.chat.listMemories(roomId)).toHaveLength(1);

		await a.chat.deleteMemory(created.id);
		await converge(a, b);
		expect(await b.chat.listMemories(roomId)).toHaveLength(0);

		// Even after another round, B does not revive its own copy.
		await converge(a, b);
		expect(await a.chat.listMemories(roomId)).toHaveLength(0);
		expect(await b.chat.listMemories(roomId)).toHaveLength(0);
	});

	it("memories each device added **both** stay", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const roomId = await sharedRoom(a, b);

		await a.chat.createMemory({ roomId, content: "A's memory" });
		await b.chat.createMemory({ roomId, content: "B's memory" });
		await converge(a, b);
		await converge(a, b);

		const onA = (await a.chat.listMemories(roomId)).map((m) => m.content);
		const onB = (await b.chat.listMemories(roomId)).map((m) => m.content);
		expect(onA.sort()).toEqual(["A's memory", "B's memory"]);
		expect(onB.sort()).toEqual(["A's memory", "B's memory"]);
	});
});

describe("conflicts", () => {
	it("concurrent edits to the same memory have one deterministic winner and converge", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const roomId = await sharedRoom(a, b);
		const created = await a.chat.createMemory({ roomId, content: "Original" });
		await converge(a, b);

		// Two offline edits. Whichever one wins, the answer must be the same.
		await a.chat.updateMemory(created.id, { content: "Content edited by A" });
		await b.chat.updateMemory(created.id, { content: "Content edited by B" });
		await converge(a, b);
		await converge(a, b);

		const onA = await a.chat.listMemories(roomId);
		const onB = await b.chat.listMemories(roomId);
		expect(onA).toHaveLength(1);
		expect(onB).toHaveLength(1);
		expect(onA[0].content).toBe(onB[0].content);
		// Text is not merged. One side's version wins as a whole.
		expect(["Content edited by A", "Content edited by B"]).toContain(
			onA[0].content,
		);
	});

	it("when deletion and edit collide, deletion wins", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const roomId = await sharedRoom(a, b);
		const created = await a.chat.createMemory({ roomId, content: "Original" });
		await converge(a, b);

		await a.chat.deleteMemory(created.id);
		await b.chat.updateMemory(created.id, { content: "Content edited by B" });
		await converge(a, b);
		await converge(a, b);

		expect(await a.chat.listMemories(roomId)).toHaveLength(0);
		expect(await b.chat.listMemories(roomId)).toHaveLength(0);
	});

	it("a room tombstone erases the receiving device's memories too", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const roomId = await sharedRoom(a, b);
		await a.chat.createMemory({ roomId, content: "Memory 1" });
		await a.chat.createMemory({ roomId, content: "Memory 2" });
		await converge(a, b);
		expect(await b.chat.listMemories(roomId)).toHaveLength(2);

		/**
		 * Only one room tombstone goes over the wire. The receiving device runs the same cascade again,
		 * which is the other half of the design. If memory were left out of the cascade, B would keep a
		 * memory with no parent, and the next collection would upload it back to the server.
		 */
		await a.chat.deleteRoom(roomId);
		await converge(a, b);

		expect(await b.chat.getRoom(roomId)).toBeNull();
		const orphans = (await b.db.chatMemories.toArray()).filter(
			(memory) => memory.deletedAt === null,
		);
		expect(orphans).toHaveLength(0);
	});
});

describe("compatibility", () => {
	it("a client that does not know `chat.memory` ignores it and only advances the cursor", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const roomId = await sharedRoom(a, b);
		await a.chat.createMemory({ roomId, content: "Memory" });
		await converge(a, b);

		/**
		 * Imitates an old client. If no codec exists for this type, the record is ignored as unknown_type
		 * and the cursor still advances. That is why adding a type does not break compatibility.
		 */
		server.seed({
			id: "future-record",
			type: "chat.futureThing",
			ciphertext: "An unopenable value",
			envelope: 1,
			version: 1,
			deleted: false,
		});

		// A memory that arrives later must still arrive normally. Ignoring the unknown record does not
		// block the cursor.
		await a.chat.createMemory({ roomId, content: "Memory after that" });
		await converge(a, b);

		const contents = (await b.chat.listMemories(roomId)).map((m) => m.content);
		expect(contents.sort()).toEqual(["Memory", "Memory after that"]);
	});
});
