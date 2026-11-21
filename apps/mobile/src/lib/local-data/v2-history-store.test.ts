import type {
	ChatMemory,
	ChatStore,
	ChatSummary,
	ChatSummaryFrontier,
} from "@rowcat/chat";
import {
	createMemoryRecord,
	freshChatSyncMeta,
	promoteMemoryPatch,
	summaryIdFor,
} from "@rowcat/chat";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seed } from "../../test/fixtures.ts";
import {
	createMemorySecureStorage,
	createTempDirectory,
	createTestScopeController,
} from "../../test/sqlite-node.ts";
import type { LocalScopeController } from "./activation.ts";
import { newLocalId, nowIso } from "./clock.ts";
import { nextRev } from "./hlc.ts";
import type { MobileDatabase } from "./sqlite.ts";
import { chatMemoryTable, chatSummaryTable } from "./tables.ts";

/**
 * Memory V2's historical records on SQLite, with **the same behavior matrix** as the web adapter
 * (`apps/web/src/lib/local-chat/v2-history-store.test.ts`).
 *
 * V2 (a model-written rolling summary plus automatic memories) is removed; afterstate is the only
 * long-term memory engine. Devices still hold V2's rows, so they are seeded here straight into the
 * tables, the way an install that ran V2 or a sync pull left them. The rewind rule lives once in
 * `@rowcat/chat` (`planHistoryRewind`), but **it is written into records once per store**. If the
 * two diverge, the same edit leaves different results on two devices, which usually surfaces as one
 * side overwriting the other at the next sync.
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

const FRONTIER: ChatSummaryFrontier = {
	createdAt: "2026-08-25T01:00:00.000Z",
	messageId: "m-60",
};

/** A V2 summary row, written with a fresh revision from this device's clock and left dirty. */
const seedSummary = (
	target: MobileDatabase,
	input: { roomId: string; summary: string; frontier: ChatSummaryFrontier },
): Promise<ChatSummary> =>
	target.transaction(async (tx) => {
		const now = nowIso();
		const record: ChatSummary = {
			id: summaryIdFor(input.roomId),
			roomId: input.roomId,
			summary: input.summary,
			frontier: input.frontier,
			epoch: 0,
			createdAt: now,
			updatedAt: now,
			deletedAt: null,
			...freshChatSyncMeta(await nextRev(tx)),
		};
		await chatSummaryTable.upsert(tx, record);
		return record;
	});

/** An automatic (`source: "auto"`) memory row, as V2's maintenance once created it. */
const seedAutoMemory = (
	target: MobileDatabase,
	input: { roomId: string; content: string; originAt: string | null },
): Promise<ChatMemory> =>
	target.transaction(async (tx) => {
		const record = createMemoryRecord(
			{
				roomId: input.roomId,
				content: input.content,
				source: "auto",
				originAt: input.originAt,
			},
			{ id: newLocalId(), now: nowIso(), rev: await nextRev(tx) },
		);
		await chatMemoryTable.upsert(tx, record);
		return record;
	});

const summaryRow = (roomId: string) =>
	db.first<{
		deleted_at: string | null;
		dirty: number;
		frontier_created_at: string | null;
		frontier_message_id: string | null;
	}>("SELECT * FROM chat_summary WHERE id = ?", [summaryIdFor(roomId)]);

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

const frontierAt = (message: {
	id: string;
	createdAt: string;
}): ChatSummaryFrontier => ({
	createdAt: message.createdAt,
	messageId: message.id,
});

describe("the store port", () => {
	/** V2's only writer was `applyMemoryMaintenance`; without it nothing writes V2 records here. */
	it("has no maintenance writer", () => {
		expect("applyMemoryMaintenance" in chat).toBe(false);
	});
});

describe("Summary", () => {
	it("a room with no V2 history has no summary", async () => {
		const room = await newRoom();
		expect(await chat.getSummary(room.id)).toBeNull();
	});

	it("reads a stored summary and frontier as they are", async () => {
		const room = await newRoom();
		await seedSummary(db, {
			roomId: room.id,
			summary: "The story so far.",
			frontier: FRONTIER,
		});

		const summary = await chat.getSummary(room.id);
		expect(summary?.summary).toBe("The story so far.");
		expect(summary?.frontier).toEqual(FRONTIER);
		expect(summary?.id).toBe(summaryIdFor(room.id));
		expect(summary?.epoch).toBe(0);
	});

	it("a deleted room's summary is not visible", async () => {
		const room = await newRoom();
		await seedSummary(db, {
			roomId: room.id,
			summary: "The story so far.",
			frontier: FRONTIER,
		});
		await chat.deleteRoom(room.id);
		expect(await chat.getSummary(room.id)).toBeNull();
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
		await seedSummary(db, {
			roomId: room.id,
			summary: "The story so far.",
			frontier: frontierAt(message),
		});

		await chat.deleteFromMessage(message.id);

		const summary = await chat.getSummary(room.id);
		expect(summary?.summary).toBe("");
		expect(summary?.frontier).toBeNull();
		expect(summary?.epoch).toBe(1);
		const row = await summaryRow(room.id);
		expect(row?.frontier_created_at).toBeNull();
		expect(row?.frontier_message_id).toBeNull();
		/** Retired by rewriting, not tombstoning; a local change the other devices must hear about. */
		expect(row?.deleted_at).toBeNull();
		expect(row?.dirty).toBe(1);
	});
});

describe("protecting human-written memories", () => {
	/**
	 * An auto memory a person edited is theirs. Deleting it on a rewind would erase a sentence the
	 * person just wrote.
	 */
	it("a rewind doesn't touch an auto memory a person promoted", async () => {
		const room = await newRoom();
		const messages = await conversation(room.id, 4);
		const auto = await seedAutoMemory(db, {
			roomId: room.id,
			content: "An automatically extracted fact",
			originAt: messages[3].createdAt,
		});
		await chat.updateMemory(
			auto.id,
			promoteMemoryPatch("A sentence a person edited"),
		);

		await chat.deleteFromMessage(messages[1].id);

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

describe("history rewrite", () => {
	it("a rewrite short of the frontier doesn't touch the historical records", async () => {
		const room = await newRoom();
		const messages = await conversation(room.id, 6);
		const seeded = await seedSummary(db, {
			roomId: room.id,
			summary: "The story so far.",
			frontier: frontierAt(messages[1]),
		});
		await seedAutoMemory(db, {
			roomId: room.id,
			content: "A fact that must survive",
			originAt: messages[1].createdAt,
		});

		await chat.deleteFromMessage(messages[4].id);

		const summary = await chat.getSummary(room.id);
		expect(summary?.summary).toBe("The story so far.");
		expect(summary?.epoch).toBe(0);
		/** No useless revision: an untouched summary must not become a push candidate on every edit. */
		expect(summary?.rev).toEqual(seeded.rev);
		expect(await chat.listMemories(room.id)).toHaveLength(1);
	});

	it("deletes only automatic memories from the vanished span — manual memories all remain", async () => {
		const room = await newRoom();
		const messages = await conversation(room.id, 6);
		await chat.createMemory({
			roomId: room.id,
			content: "A setting a person wrote down",
		});
		await seedSummary(db, {
			roomId: room.id,
			summary: "The story so far.",
			frontier: frontierAt(messages[4]),
		});
		await seedAutoMemory(db, {
			roomId: room.id,
			content: "A surviving automatic fact",
			originAt: messages[1].createdAt,
		});
		const vanishing = await seedAutoMemory(db, {
			roomId: room.id,
			content: "An automatic fact that will vanish",
			originAt: messages[4].createdAt,
		});
		/** No recorded origin: the rule cannot prove it predates the cut, so it goes too. */
		await seedAutoMemory(db, {
			roomId: room.id,
			content: "An automatic fact of unknown origin",
			originAt: null,
		});

		await chat.deleteFromMessage(messages[3].id);

		expect(
			(await chat.listMemories(room.id)).map((memory) => memory.content).sort(),
		).toEqual(["A setting a person wrote down", "A surviving automatic fact"]);
		expect((await chat.getSummary(room.id))?.epoch).toBe(1);

		/** A tombstone, not a removed row: another device would otherwise resurrect it on upload. */
		const row = await db.first<{ deleted_at: string | null; dirty: number }>(
			"SELECT * FROM chat_memory WHERE id = ?",
			[vanishing.id],
		);
		expect(row?.deleted_at).not.toBeNull();
		expect(row?.dirty).toBe(1);
	});

	it("single deletions go through the rewind too", async () => {
		const room = await newRoom();
		const messages = await conversation(room.id, 4);
		await seedSummary(db, {
			roomId: room.id,
			summary: "The story so far.",
			frontier: frontierAt(messages[3]),
		});
		await seedAutoMemory(db, {
			roomId: room.id,
			content: "A fact from the deleted line onward",
			originAt: messages[3].createdAt,
		});

		await chat.deleteMessage(messages[1].id);

		expect((await chat.getSummary(room.id))?.summary).toBe("");
		expect(await chat.listMemories(room.id)).toEqual([]);
	});

	it("edits go through the rewind too", async () => {
		const room = await newRoom();
		const messages = await conversation(room.id, 4);
		await seedSummary(db, {
			roomId: room.id,
			summary: "The story so far.",
			frontier: frontierAt(messages[3]),
		});
		await seedAutoMemory(db, {
			roomId: room.id,
			content: "A fact from the edited line onward",
			originAt: messages[3].createdAt,
		});

		// Index 2 is a user message; roles alternate starting from index 0.
		await chat.editUserMessage(messages[2].id, "A rewritten line");

		expect((await chat.getSummary(room.id))?.summary).toBe("");
		expect(await chat.listMemories(room.id)).toEqual([]);
	});
});

describe("room deletion", () => {
	it("the summary and automatic memories are deleted too", async () => {
		const room = await newRoom();
		await seedSummary(db, {
			roomId: room.id,
			summary: "The story so far.",
			frontier: FRONTIER,
		});
		const auto = await seedAutoMemory(db, {
			roomId: room.id,
			content: "An automatic fact",
			originAt: FRONTIER.createdAt,
		});
		await chat.deleteRoom(room.id);

		expect(await chat.getSummary(room.id)).toBeNull();
		expect((await summaryRow(room.id))?.deleted_at).not.toBeNull();
		const memory = await db.first<{ deleted_at: string | null }>(
			"SELECT * FROM chat_memory WHERE id = ?",
			[auto.id],
		);
		expect(memory?.deleted_at).not.toBeNull();
	});
});

describe("isolation", () => {
	it("other rooms' summaries don't mix in", async () => {
		const first = await newRoom("First room");
		const second = await newRoom("Second room");
		await seedSummary(db, {
			roomId: first.id,
			summary: "The first room's story",
			frontier: FRONTIER,
		});

		expect((await chat.getSummary(first.id))?.summary).toBe(
			"The first room's story",
		);
		expect(await chat.getSummary(second.id)).toBeNull();
	});

	it("a rewind in one room doesn't touch another room's records", async () => {
		const first = await newRoom("First room");
		const second = await newRoom("Second room");
		const messages = await conversation(first.id, 4);
		await seedSummary(db, {
			roomId: second.id,
			summary: "The second room's story",
			frontier: frontierAt(messages[3]),
		});
		await seedAutoMemory(db, {
			roomId: second.id,
			content: "The second room's fact",
			originAt: messages[3].createdAt,
		});

		await chat.deleteFromMessage(messages[0].id);

		expect((await chat.getSummary(second.id))?.summary).toBe(
			"The second room's story",
		);
		expect(await chat.listMemories(second.id)).toHaveLength(1);
	});

	/** Member isolation comes from separate database files, not a query condition. */
	it("another account's summaries and memories are not visible", async () => {
		const room = await newRoom();
		await seedSummary(db, {
			roomId: room.id,
			summary: "Alice's conversation",
			frontier: FRONTIER,
		});
		await seedAutoMemory(db, {
			roomId: room.id,
			content: "A fact only Alice knows",
			originAt: FRONTIER.createdAt,
		});

		const bob = await controller.activate("bob");
		expect(await bob.stores.chat.getSummary(room.id)).toBeNull();
		expect(await bob.stores.chat.listMemories(room.id)).toEqual([]);
	});
});

describe("counting messages", () => {
	it("counts live messages only, per room", async () => {
		const room = await newRoom("First room");
		const other = await newRoom("Second room");
		const messages = await conversation(room.id, 5);
		await conversation(other.id, 2);

		expect(await chat.countMessages(room.id)).toBe(5);

		/** Tombstones stay in the table; the count must not see them. */
		await chat.deleteMessage(messages[0].id);
		await chat.deleteFromMessage(messages[3].id);
		expect(await chat.countMessages(room.id)).toBe(2);
		expect(await chat.countMessages(other.id)).toBe(2);
	});

	it("an empty, deleted or missing room counts zero", async () => {
		const empty = await newRoom("Empty room");
		const room = await newRoom("Full room");
		await conversation(room.id, 3);

		expect(await chat.countMessages(empty.id)).toBe(0);
		await chat.deleteRoom(room.id);
		expect(await chat.countMessages(room.id)).toBe(0);
		expect(await chat.countMessages("no-such-room")).toBe(0);
	});
});
