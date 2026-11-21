import type { ChatSeed } from "@rowcat/chat";
import { promoteMemoryPatch, summaryIdFor } from "@rowcat/chat";
import { CHAT_SEED_VERSION } from "@rowcat/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
	converge,
	createDevice,
	type Device,
	FakeSyncServer,
} from "#/test/sync-devices.ts";
import { seedV2AutoMemory, seedV2Summary } from "#/test/v2-history.ts";

/**
 * Two-device round trip for Memory V2's historical records: the summary (`chat.summary`) and
 * automatic memories.
 *
 * V2 is removed and nothing writes these records any more, but devices still hold them and an older
 * client may still push them. They are seeded here as dirty local rows (`#/test/v2-history.ts`), the
 * way such a client leaves them, so the next sync run pushes them. This file checks:
 * - the records still decode, propagate and merge into one identity
 * - a rewind on one device beats the other side's stale record, so the summary of a deleted
 *   conversation does not come back
 * - room deletion takes them along, and an unknown type does not block the cursor
 *
 * The rewind case is this file's reason to exist. With plain HLC last-writer-wins, the stale record
 * written later would win and the summary of an event the user deleted would revive. That state never
 * heals on its own.
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

const sharedRoom = async (a: Device, b: Device): Promise<string> => {
	const room = await a.chat.createRoom({
		originStoryId: null,
		seed: seed("Long conversation"),
	});
	await converge(a, b);
	return room.id;
};

const FRONTIER = {
	createdAt: "2026-08-25T01:00:00.000Z",
	messageId: "m-60",
};

describe("summary propagation", () => {
	it("A's stored summary and frontier arrive at B as is", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const roomId = await sharedRoom(a, b);

		await seedV2Summary(a.db, {
			roomId,
			summary: "The two met at the harbor.",
			frontier: FRONTIER,
		});
		await converge(a, b);

		const received = await b.chat.getSummary(roomId);
		expect(received?.summary).toBe("The two met at the harbor.");
		expect(received?.frontier).toEqual(FRONTIER);
		expect(received?.epoch).toBe(0);
	});

	/**
	 * With random ids, the summaries each device held would be two different identities, and both
	 * would survive. Nothing could say which one is the room's summary. With a shared id, the case
	 * ends as one ordinary merge.
	 */
	it("summaries held separately on two devices merge into one", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const roomId = await sharedRoom(a, b);

		await seedV2Summary(a.db, {
			roomId,
			summary: "A's summary",
			frontier: FRONTIER,
		});
		await seedV2Summary(b.db, {
			roomId,
			summary: "B's summary",
			frontier: FRONTIER,
		});
		await converge(a, b);
		await converge(a, b);

		const left = await a.chat.getSummary(roomId);
		const right = await b.chat.getSummary(roomId);
		expect(left?.summary).toBe(right?.summary);
		expect(await a.db.chatSummaries.count()).toBe(1);
		expect(await b.db.chatSummaries.count()).toBe(1);
	});

	it("within an epoch it is a plain last writer", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const roomId = await sharedRoom(a, b);

		await seedV2Summary(a.db, { roomId, summary: "S1", frontier: FRONTIER });
		await converge(a, b);

		await seedV2Summary(b.db, {
			roomId,
			summary: "S2",
			frontier: { createdAt: "2026-08-25T02:00:00.000Z", messageId: "m-80" },
		});
		await converge(a, b);

		expect((await a.chat.getSummary(roomId))?.summary).toBe("S2");
		expect((await a.chat.getSummary(roomId))?.frontier?.messageId).toBe("m-80");
	});
});

describe("auto memory propagation", () => {
	it("source and origin time are kept", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const roomId = await sharedRoom(a, b);

		await a.chat.createMemory({ roomId, content: "Memory a person wrote" });
		await seedV2AutoMemory(a.db, {
			roomId,
			content: "Automatically extracted fact",
			originAt: FRONTIER.createdAt,
		});
		await converge(a, b);

		const received = await b.chat.listMemories(roomId);
		const bySource = Object.fromEntries(
			received.map((memory) => [memory.content, memory.source]),
		);
		expect(bySource).toEqual({
			"Memory a person wrote": "user",
			"Automatically extracted fact": "auto",
		});
		const auto = received.find((memory) => memory.source === "auto");
		expect(auto?.originAt).toBe(FRONTIER.createdAt);
		const manual = received.find((memory) => memory.source === "user");
		expect(manual?.originAt).toBeNull();
	});

	/**
	 * The one change a person can still make to an auto memory: editing it makes it theirs. The other
	 * device must see the same identity, now human-written, so its own rewinds leave it alone.
	 */
	it("a person's promotion propagates keeping its identity", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const roomId = await sharedRoom(a, b);

		const auto = await seedV2AutoMemory(a.db, {
			roomId,
			content: "Kai has the key.",
			originAt: FRONTIER.createdAt,
		});
		await converge(a, b);

		await a.chat.updateMemory(
			auto.id,
			promoteMemoryPatch("Kai gave the key to Yuna."),
		);
		await converge(a, b);

		const after = await b.chat.listMemories(roomId);
		expect(after).toHaveLength(1);
		expect(after[0].id).toBe(auto.id);
		expect(after[0].content).toBe("Kai gave the key to Yuna.");
		expect(after[0].source).toBe("user");
	});

	it("a rewind's removal propagates as a tombstone; manual memories stay", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const roomId = await sharedRoom(a, b);

		const message = await a.chat.appendMessage({
			roomId,
			role: "user",
			content: "Utterance to delete later",
		});
		await a.chat.createMemory({ roomId, content: "Memory a person wrote" });
		const auto = await seedV2AutoMemory(a.db, {
			roomId,
			content: "Fact from the deleted span",
			originAt: message.createdAt,
		});
		await converge(a, b);
		expect(await b.chat.listMemories(roomId)).toHaveLength(2);

		await a.chat.deleteFromMessage(message.id);
		await converge(a, b);

		expect(
			(await b.chat.listMemories(roomId)).map((memory) => memory.content),
		).toEqual(["Memory a person wrote"]);
		expect((await b.db.chatMemories.get(auto.id))?.deletedAt).not.toBeNull();
	});
});

describe("rewind precedence", () => {
	/**
	 * The subtlest merge rule for these records: epoch first.
	 *
	 * A deleted the past, retiring the summary and raising its epoch. B, not knowing this, rewrote the
	 * old summary later (an older V2 client still running there). Looking only at HLC, B's later write
	 * would win, and the summary of a deleted conversation would come back.
	 */
	it("one side's rewind beats the other side's later stale record", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const roomId = await sharedRoom(a, b);

		const message = await a.chat.appendMessage({
			roomId,
			role: "user",
			content: "Utterance to delete later",
		});
		await seedV2Summary(a.db, {
			roomId,
			summary: "Summary containing an event to be erased",
			frontier: { createdAt: message.createdAt, messageId: message.id },
		});
		await converge(a, b);
		expect((await b.chat.getSummary(roomId))?.summary).toBe(
			"Summary containing an event to be erased",
		);

		// A deletes that span. The summary is retired and the epoch is raised.
		await a.chat.deleteFromMessage(message.id);
		// B, unaware of that, writes the old-epoch summary even later.
		await seedV2Summary(b.db, {
			roomId,
			summary: "Summary still telling that event",
			frontier: { createdAt: "2026-08-25T09:00:00.000Z", messageId: "m-99" },
		});
		expect((await b.chat.getSummary(roomId))?.epoch).toBe(0);

		await converge(a, b);
		await converge(a, b);

		for (const device of [a, b]) {
			const summary = await device.chat.getSummary(roomId);
			expect(summary?.summary).toBe("");
			expect(summary?.frontier).toBeNull();
			expect(summary?.epoch).toBe(1);
		}
	});

	/**
	 * Nothing advances summaries any more, so a retired summary stays retired: later turns and syncs on
	 * either device write no new summary text and no new epoch.
	 */
	it("nothing re-advances a retired summary", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const roomId = await sharedRoom(a, b);

		const message = await a.chat.appendMessage({
			roomId,
			role: "user",
			content: "Utterance to delete",
		});
		await seedV2Summary(a.db, {
			roomId,
			summary: "The story so far.",
			frontier: { createdAt: message.createdAt, messageId: message.id },
		});
		await a.chat.deleteFromMessage(message.id);
		await converge(a, b);

		await b.chat.appendMessage({ roomId, role: "user", content: "Later turn" });
		await a.chat.appendMessage({
			roomId,
			role: "assistant",
			content: "Later reply",
		});
		await converge(a, b);
		await converge(a, b);

		for (const device of [a, b]) {
			const summary = await device.chat.getSummary(roomId);
			expect(summary?.summary).toBe("");
			expect(summary?.frontier).toBeNull();
			expect(summary?.epoch).toBe(1);
			expect(await device.db.chatSummaries.count()).toBe(1);
		}
	});
});

describe("room deletion", () => {
	it("one room tombstone takes the summary and memories with it", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const roomId = await sharedRoom(a, b);

		await seedV2Summary(a.db, {
			roomId,
			summary: "The story so far.",
			frontier: FRONTIER,
		});
		await seedV2AutoMemory(a.db, {
			roomId,
			content: "Auto fact",
			originAt: FRONTIER.createdAt,
		});
		await converge(a, b);
		expect(await b.chat.getSummary(roomId)).not.toBeNull();

		await a.chat.deleteRoom(roomId);
		await converge(a, b);

		expect(await b.chat.getSummary(roomId)).toBeNull();
		expect(await b.chat.listMemories(roomId)).toEqual([]);
		/**
		 * The receiving device's summary row really is a tombstone. If the cascade were missed, an orphan
		 * summary would survive on that device alone, and the next collection would upload the summary of
		 * an already-deleted room back to the server.
		 */
		expect(
			(await b.db.chatSummaries.get(summaryIdFor(roomId)))?.deletedAt,
		).not.toBeNull();
	});
});

describe("compatibility", () => {
	/**
	 * The server has no type vocabulary. A client that does not know a type ignores the record and
	 * advances only its cursor; that is also how an older client treats records it no longer knows.
	 */
	it("an unknown type does not block the cursor", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const roomId = await sharedRoom(a, b);
		await seedV2Summary(a.db, { roomId, summary: "S1", frontier: FRONTIER });
		await converge(a, b);

		/**
		 * A record with no codec for it is ignored as unknown_type, and the cursor still advances. The
		 * summary update after it checks that later records still arrive.
		 */
		server.seed({
			id: "future-record",
			type: "chat.futureThing",
			ciphertext: "An unopenable value",
			envelope: 1,
			version: 1,
			deleted: false,
		});

		await seedV2Summary(a.db, {
			roomId,
			summary: "S2",
			frontier: { createdAt: "2026-08-25T02:00:00.000Z", messageId: "m-80" },
		});
		await converge(a, b);

		expect((await b.chat.getSummary(roomId))?.summary).toBe("S2");
	});
});
