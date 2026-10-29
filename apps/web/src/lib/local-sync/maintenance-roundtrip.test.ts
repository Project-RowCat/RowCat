import type { ChatMaintenancePlan, ChatSeed } from "@rowcat/chat";
import { summaryIdFor } from "@rowcat/chat";
import { CHAT_SEED_VERSION } from "@rowcat/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
	converge,
	createDevice,
	type Device,
	FakeSyncServer,
} from "#/test/sync-devices.ts";

/**
 * Two-device round trip for automatic maintenance state: summaries and auto-memory.
 *
 * This lives in its own file because the slice must prove it added only one type to the protocol
 * (chat.summary). memory-roundtrip.test.ts guards memory convergence. This file checks two more
 * things:
 * - Whether summary state reaches the same value on both devices, with one identity.
 * - Whether a rewind beats concurrent forward progress, so the summary of a deleted conversation
 *   does not come back.
 *
 * The second is this file's reason to exist. With plain HLC last-writer-wins, the later forward
 * write would win and the summary of an event the user deleted would revive. That state never heals
 * on its own.
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

const plan = (
	roomId: string,
	overrides: Partial<ChatMaintenancePlan> = {},
): ChatMaintenancePlan & { roomId: string } => ({
	roomId,
	summary: "The story so far.",
	through: FRONTIER,
	operations: [],
	expect: { epoch: 0, frontier: null },
	...overrides,
});

describe("summary propagation", () => {
	it("A's summary and frontier arrive at B as is", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const roomId = await sharedRoom(a, b);

		await a.chat.applyMemoryMaintenance(
			plan(roomId, { summary: "The two met at the harbor." }),
		);
		await converge(a, b);

		const received = await b.chat.getSummary(roomId);
		expect(received?.summary).toBe("The two met at the harbor.");
		expect(received?.frontier).toEqual(FRONTIER);
		expect(received?.epoch).toBe(0);
	});

	/**
	 * With random ids, the summaries each device created would be two different identities, and both
	 * would survive. Nothing could say which one is the room's summary. With a shared id, the case
	 * ends as one ordinary merge.
	 */
	it("summaries made separately on two devices merge into one", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const roomId = await sharedRoom(a, b);

		await a.chat.applyMemoryMaintenance(
			plan(roomId, { summary: "A's summary" }),
		);
		await b.chat.applyMemoryMaintenance(
			plan(roomId, { summary: "B's summary" }),
		);
		await converge(a, b);
		await converge(a, b);

		const left = await a.chat.getSummary(roomId);
		const right = await b.chat.getSummary(roomId);
		expect(left?.summary).toBe(right?.summary);
		expect(await a.db.chatSummaries.count()).toBe(1);
		expect(await b.db.chatSummaries.count()).toBe(1);
	});

	it("the later advance wins; within an epoch it is a plain last writer", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const roomId = await sharedRoom(a, b);

		await a.chat.applyMemoryMaintenance(plan(roomId, { summary: "S1" }));
		await converge(a, b);

		await b.chat.applyMemoryMaintenance(
			plan(roomId, {
				summary: "S2",
				expect: { epoch: 0, frontier: FRONTIER },
				through: { createdAt: "2026-08-25T02:00:00.000Z", messageId: "m-80" },
			}),
		);
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
		await a.chat.applyMemoryMaintenance(
			plan(roomId, {
				operations: [{ type: "add", content: "Automatically extracted fact" }],
			}),
		);
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

	it("a replacement propagates keeping its identity", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const roomId = await sharedRoom(a, b);

		await a.chat.applyMemoryMaintenance(
			plan(roomId, {
				operations: [{ type: "add", content: "Kai has the key." }],
			}),
		);
		await converge(a, b);
		const [before] = await b.chat.listMemories(roomId);

		await a.chat.applyMemoryMaintenance(
			plan(roomId, {
				expect: { epoch: 0, frontier: FRONTIER },
				through: { createdAt: "2026-08-25T02:00:00.000Z", messageId: "m-80" },
				operations: [
					{
						type: "replace",
						memoryId: before.id,
						content: "Kai gave the key to Yuna.",
					},
				],
			}),
		);
		await converge(a, b);

		const after = await b.chat.listMemories(roomId);
		expect(after).toHaveLength(1);
		expect(after[0].id).toBe(before.id);
		expect(after[0].content).toBe("Kai gave the key to Yuna.");
	});

	it("a removal propagates as a tombstone", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const roomId = await sharedRoom(a, b);

		await a.chat.applyMemoryMaintenance(
			plan(roomId, { operations: [{ type: "add", content: "Passing fact" }] }),
		);
		await converge(a, b);
		const [created] = await b.chat.listMemories(roomId);

		await a.chat.applyMemoryMaintenance(
			plan(roomId, {
				expect: { epoch: 0, frontier: FRONTIER },
				operations: [{ type: "remove", memoryId: created.id }],
			}),
		);
		await converge(a, b);

		expect(await b.chat.listMemories(roomId)).toEqual([]);
	});
});

describe("rewind precedence", () => {
	/**
	 * The subtlest merge rule in this slice: generation first.
	 *
	 * A deleted the past, dropping the summary and bumping the generation. B, not knowing this,
	 * advanced the old summary by one step. Looking only at HLC, B's later write would win, and the
	 * summary of a deleted conversation would come back.
	 */
	it("one side's rewind beats the other side's concurrent advance", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const roomId = await sharedRoom(a, b);

		const message = await a.chat.appendMessage({
			roomId,
			role: "user",
			content: "Utterance to delete later",
		});
		await a.chat.applyMemoryMaintenance(
			plan(roomId, {
				summary: "Summary containing an event to be erased",
				through: { createdAt: message.createdAt, messageId: message.id },
			}),
		);
		await converge(a, b);
		expect((await b.chat.getSummary(roomId))?.summary).toBe(
			"Summary containing an event to be erased",
		);

		// A deletes that span. The summary is dropped and the generation is bumped.
		await a.chat.deleteFromMessage(message.id);
		// B, unaware of that, advances the summary even later.
		await b.chat.applyMemoryMaintenance(
			plan(roomId, {
				summary: "Summary still telling that event",
				expect: {
					epoch: 0,
					frontier: { createdAt: message.createdAt, messageId: message.id },
				},
				through: { createdAt: "2026-08-25T09:00:00.000Z", messageId: "m-99" },
			}),
		);

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
	 * And there is no deadlock. If 'the empty summary wins' were the rule, a device holding a stale
	 * rewind would revert every later advance forever, and the room's summary would never progress
	 * again. The generation only increases, so forward progress after a rewind wins normally within
	 * the same generation.
	 */
	it("summaries advance again after a rewind", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const roomId = await sharedRoom(a, b);

		const message = await a.chat.appendMessage({
			roomId,
			role: "user",
			content: "Utterance to delete",
		});
		await a.chat.applyMemoryMaintenance(
			plan(roomId, {
				through: { createdAt: message.createdAt, messageId: message.id },
			}),
		);
		await a.chat.deleteFromMessage(message.id);
		await converge(a, b);

		await b.chat.applyMemoryMaintenance(
			plan(roomId, {
				summary: "Summary rebuilt after the rewind",
				expect: { epoch: 1, frontier: null },
			}),
		);
		await converge(a, b);
		await converge(a, b);

		for (const device of [a, b])
			expect((await device.chat.getSummary(roomId))?.summary).toBe(
				"Summary rebuilt after the rewind",
			);
	});
});

describe("room deletion", () => {
	it("one room tombstone takes the summary with it", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const roomId = await sharedRoom(a, b);

		await a.chat.applyMemoryMaintenance(
			plan(roomId, { operations: [{ type: "add", content: "Auto fact" }] }),
		);
		await converge(a, b);

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
	 * This slice's compatibility claim itself. The server has no type vocabulary. An old client that
	 * does not know chat.summary ignores the record and advances only its cursor. That is why neither
	 * SYNC_PROTOCOL_VERSION nor the envelope version is bumped.
	 */
	it("an unknown type does not block the cursor", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const roomId = await sharedRoom(a, b);
		await a.chat.applyMemoryMaintenance(plan(roomId, { summary: "S1" }));
		await converge(a, b);

		/**
		 * Imitates an old client. A record with no codec for it is ignored as unknown_type, and the
		 * cursor still advances. That is why adding a type to the protocol does not break compatibility.
		 * The advancement after it checks that the summary rests on this rule.
		 */
		server.seed({
			id: "future-record",
			type: "chat.futureThing",
			ciphertext: "An unopenable value",
			envelope: 1,
			version: 1,
			deleted: false,
		});

		await a.chat.applyMemoryMaintenance(
			plan(roomId, {
				summary: "S2",
				expect: { epoch: 0, frontier: FRONTIER },
				through: { createdAt: "2026-08-25T02:00:00.000Z", messageId: "m-80" },
			}),
		);
		await converge(a, b);

		expect((await b.chat.getSummary(roomId))?.summary).toBe("S2");
	});
});
