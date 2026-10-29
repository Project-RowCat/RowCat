import type { ChatMaintenancePlan, ChatStore } from "@rowcat/chat";
import { promoteMemoryPatch, summaryIdFor } from "@rowcat/chat";
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
 * SQLite implementation of automatic maintenance, with **the same behavior matrix** as the web
 * adapter.
 *
 * The point is that both files check the same things. The rules live once in the pure package
 * (`memory-maintenance.ts` in `@rowcat/chat`), but **the commit is implemented once per store**. If
 * the two diverge, the same maintenance leaves different results on two devices. That difference is
 * only visible side by side, and usually surfaces as one side overwriting the other at the next
 * sync.
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

const newRoom = (title = "A long conversation") =>
	chat.createRoom({ originStoryId: "story-1", seed: seed(title), title });

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

describe("Summary", () => {
	it("a room that hasn't run has no summary", async () => {
		const room = await newRoom();
		expect(await chat.getSummary(room.id)).toBeNull();
	});

	it("summary, frontier and automatic memories commit at once", async () => {
		const room = await newRoom();
		expect(
			await chat.applyMemoryMaintenance(
				plan(room.id, {
					operations: [{ type: "add", content: "Kai has the key." }],
				}),
			),
		).toBe(true);

		const summary = await chat.getSummary(room.id);
		expect(summary?.summary).toBe("The story so far.");
		expect(summary?.frontier).toEqual(FRONTIER);
		expect(summary?.id).toBe(summaryIdFor(room.id));

		const [memory] = await chat.listMemories(room.id);
		expect(memory.source).toBe("auto");
		expect(memory.originAt).toBe(FRONTIER.createdAt);
	});

	/**
	 * Splitting the frontier into two columns is the only place this differs from the web. The row
	 * mapping enforces the rule that **both are NULL or both are set**.
	 */
	it("a rewound summary's frontier empties both columns together", async () => {
		const room = await newRoom();
		const message = await chat.appendMessage({
			roomId: room.id,
			role: "user",
			content: "A line to delete",
		});
		await chat.applyMemoryMaintenance(
			plan(room.id, {
				through: { createdAt: message.createdAt, messageId: message.id },
			}),
		);

		await chat.deleteFromMessage(message.id);

		const summary = await chat.getSummary(room.id);
		expect(summary?.frontier).toBeNull();
		const row = await db.first<{
			frontier_created_at: string | null;
			frontier_message_id: string | null;
		}>("SELECT * FROM chat_summary WHERE id = ?", [summaryIdFor(room.id)]);
		expect(row?.frontier_created_at).toBeNull();
		expect(row?.frontier_message_id).toBeNull();
	});
});

describe("protecting human-written memories", () => {
	it("operations pointing at manual memories do nothing", async () => {
		const room = await newRoom();
		const manual = await chat.createMemory({
			roomId: room.id,
			content: "Kai is left-handed.",
		});

		await chat.applyMemoryMaintenance(
			plan(room.id, {
				operations: [
					{ type: "remove", memoryId: manual.id },
					{
						type: "replace",
						memoryId: manual.id,
						content: "Kai is right-handed.",
					},
				],
			}),
		);

		const memories = await chat.listMemories(room.id);
		expect(memories).toHaveLength(1);
		expect(memories[0].content).toBe("Kai is left-handed.");
		expect(memories[0].source).toBe("user");
	});

	/** A memory promoted **after** the plan was fixed. This pins the fact that the store does not trust the plan. */
	it("doesn't touch memories promoted in the meantime", async () => {
		const room = await newRoom();
		await chat.applyMemoryMaintenance(
			plan(room.id, {
				operations: [
					{ type: "add", content: "An automatically extracted fact" },
				],
			}),
		);
		const [auto] = await chat.listMemories(room.id);

		await chat.updateMemory(
			auto.id,
			promoteMemoryPatch("A sentence a person edited"),
		);

		await chat.applyMemoryMaintenance(
			plan(room.id, {
				expect: { epoch: 0, frontier: FRONTIER },
				operations: [{ type: "remove", memoryId: auto.id }],
			}),
		);

		const survived = (await chat.listMemories(room.id)).find(
			(memory) => memory.id === auto.id,
		);
		expect(survived?.content).toBe("A sentence a person edited");
		expect(survived?.source).toBe("user");
	});

	/** Promotion goes one way only: the product has no operation that automatically reverts a human-written memory. */
	it("the source moves only toward the person", async () => {
		const room = await newRoom();
		const manual = await chat.createMemory({
			roomId: room.id,
			content: "What a person wrote",
		});
		await chat.updateMemory(manual.id, { source: "auto" });
		expect((await chat.listMemories(room.id))[0].source).toBe("user");
	});
});

describe("optimistic concurrency", () => {
	it("refuses when the frontier advanced in the meantime", async () => {
		const room = await newRoom();
		expect(await chat.applyMemoryMaintenance(plan(room.id))).toBe(true);
		expect(
			await chat.applyMemoryMaintenance(
				plan(room.id, {
					summary: "A value that must not be overwritten",
					operations: [{ type: "add", content: "A duplicate fact" }],
				}),
			),
		).toBe(false);

		expect((await chat.getSummary(room.id))?.summary).toBe("The story so far.");
		expect(await chat.listMemories(room.id)).toEqual([]);
	});

	it("doesn't commit to a deleted room", async () => {
		const room = await newRoom();
		await chat.deleteRoom(room.id);
		expect(await chat.applyMemoryMaintenance(plan(room.id))).toBe(false);
	});
});

describe("history rewrite", () => {
	const conversation = async (roomId: string, count: number) => {
		const rows: { id: string; createdAt: string }[] = [];
		for (let index = 0; index < count; index += 1) {
			const message = await chat.appendMessage({
				roomId,
				role: index % 2 === 0 ? "user" : "assistant",
				content: `Line ${index}`,
			});
			rows.push({ id: message.id, createdAt: message.createdAt });
		}
		return rows;
	};

	it("a rewrite short of the frontier doesn't touch maintenance state", async () => {
		const room = await newRoom();
		const messages = await conversation(room.id, 6);
		await chat.applyMemoryMaintenance(
			plan(room.id, {
				through: {
					createdAt: messages[1].createdAt,
					messageId: messages[1].id,
				},
				operations: [{ type: "add", content: "A fact that must survive" }],
			}),
		);

		await chat.deleteFromMessage(messages[4].id);

		const summary = await chat.getSummary(room.id);
		expect(summary?.summary).toBe("The story so far.");
		expect(summary?.epoch).toBe(0);
		expect(await chat.listMemories(room.id)).toHaveLength(1);
	});

	it("deletes only automatic memories from the vanished span — manual memories all remain", async () => {
		const room = await newRoom();
		const messages = await conversation(room.id, 6);
		await chat.createMemory({
			roomId: room.id,
			content: "A setting a person wrote down",
		});
		await chat.applyMemoryMaintenance(
			plan(room.id, {
				through: {
					createdAt: messages[1].createdAt,
					messageId: messages[1].id,
				},
				operations: [{ type: "add", content: "A surviving automatic fact" }],
			}),
		);
		await chat.applyMemoryMaintenance(
			plan(room.id, {
				expect: {
					epoch: 0,
					frontier: {
						createdAt: messages[1].createdAt,
						messageId: messages[1].id,
					},
				},
				through: {
					createdAt: messages[4].createdAt,
					messageId: messages[4].id,
				},
				operations: [
					{ type: "add", content: "An automatic fact that will vanish" },
				],
			}),
		);

		await chat.deleteFromMessage(messages[3].id);

		expect(
			(await chat.listMemories(room.id)).map((memory) => memory.content).sort(),
		).toEqual(["A setting a person wrote down", "A surviving automatic fact"]);
		expect((await chat.getSummary(room.id))?.epoch).toBe(1);
	});

	it("single deletions and edits go through the rewind too", async () => {
		const room = await newRoom();
		const messages = await conversation(room.id, 4);
		await chat.applyMemoryMaintenance(
			plan(room.id, {
				through: {
					createdAt: messages[3].createdAt,
					messageId: messages[3].id,
				},
			}),
		);

		await chat.deleteMessage(messages[1].id);
		expect((await chat.getSummary(room.id))?.summary).toBe("");
	});
});

describe("room deletion", () => {
	it("the summary is deleted too", async () => {
		const room = await newRoom();
		await chat.applyMemoryMaintenance(plan(room.id));
		await chat.deleteRoom(room.id);

		expect(await chat.getSummary(room.id)).toBeNull();
		const row = await db.first<{ deleted_at: string | null }>(
			"SELECT * FROM chat_summary WHERE id = ?",
			[summaryIdFor(room.id)],
		);
		expect(row?.deleted_at).not.toBeNull();
	});
});

describe("isolation", () => {
	it("other rooms' summaries don't mix in", async () => {
		const first = await newRoom("First room");
		const second = await newRoom("Second room");
		await chat.applyMemoryMaintenance(
			plan(first.id, { summary: "The first room's story" }),
		);

		expect((await chat.getSummary(first.id))?.summary).toBe(
			"The first room's story",
		);
		expect(await chat.getSummary(second.id)).toBeNull();
	});
});
