import type { ChatSeed, ChatStore, ChatSummaryFrontier } from "@rowcat/chat";
import { promoteMemoryPatch, summaryIdFor } from "@rowcat/chat";
import { StoryChatSeedDto } from "@rowcat/contracts/chat";
import { afterEach, describe, expect, it } from "vitest";
import {
	activateLocalDbScope,
	type LocalDb,
	resetLocalDbScope,
} from "#/lib/local-data/db.ts";
import { seedV2AutoMemory, seedV2Summary } from "#/test/v2-history.ts";
import { createChatStore } from "./store.ts";

/**
 * Memory V2's historical records against real IndexedDB (fake-indexeddb).
 *
 * V2 (a model-written rolling summary plus automatic memories) is removed; afterstate is the only
 * long-term memory engine. Devices still hold V2's rows, so they are seeded here straight into the
 * tables, the way an install that ran V2 left them. The pure rewind rule is checked by value in
 * @rowcat/chat (`summary.test.ts`, `planHistoryRewind`). This file checks the store around it:
 * - stored summaries read back as they are, and never from a deleted room
 * - history rewrites (edit, delete, delete-from-here) retire what described the erased turns, in the
 *   same transaction, and touch nothing a person wrote
 * - room deletion carries the summary along
 * - nothing crosses rooms or accounts
 * If any of these is wrong the screen still looks normal, but the afterstate migration could import
 * a description of a conversation the user deleted.
 */

const seed = (): ChatSeed =>
	StoryChatSeedDto.parse({
		version: 1,
		storyId: "story-1",
		title: "Test story",
		adult: false,
		promptProtected: false,
	});

let sequence = 0;
const nextViewer = (label: string): string => `${label}-v2-${++sequence}`;

/** One scope per viewer: the store and the raw tables (tombstones are only visible there). */
const open = (viewerId: string): { db: LocalDb; store: ChatStore } => {
	const db = activateLocalDbScope(viewerId);
	return { db, store: createChatStore(db) };
};

afterEach(() => {
	resetLocalDbScope();
});

const roomWith = (store: ChatStore) =>
	store.createRoom({ originStoryId: "story-1", seed: seed() });

const FRONTIER: ChatSummaryFrontier = {
	createdAt: "2026-08-25T01:00:00.000Z",
	messageId: "m-60",
};

const conversation = async (
	store: ChatStore,
	roomId: string,
	count: number,
) => {
	const ids: { id: string; createdAt: string }[] = [];
	for (let index = 0; index < count; index += 1) {
		const message = await store.appendMessage({
			roomId,
			role: index % 2 === 0 ? "user" : "assistant",
			content: `Words ${index}`,
		});
		ids.push({ id: message.id, createdAt: message.createdAt });
	}
	return ids;
};

const frontierAt = (message: {
	id: string;
	createdAt: string;
}): ChatSummaryFrontier => ({
	createdAt: message.createdAt,
	messageId: message.id,
});

describe("the store port", () => {
	/**
	 * V2's only writer was `applyMemoryMaintenance`. Its absence from the port is what guarantees no
	 * new summary or automatic memory is ever written on this device.
	 */
	it("has no maintenance writer", () => {
		const { store } = open(nextViewer("alice"));
		expect("applyMemoryMaintenance" in store).toBe(false);
	});
});

describe("reading summaries", () => {
	it("a room with no V2 history has no summary", async () => {
		const { store } = open(nextViewer("alice"));
		const room = await roomWith(store);
		expect(await store.getSummary(room.id)).toBeNull();
	});

	it("reads a stored summary and frontier as they are", async () => {
		const { db, store } = open(nextViewer("alice"));
		const room = await roomWith(store);
		await seedV2Summary(db, {
			roomId: room.id,
			summary: "The story so far.",
			frontier: FRONTIER,
		});

		const summary = await store.getSummary(room.id);
		expect(summary?.summary).toBe("The story so far.");
		expect(summary?.frontier).toEqual(FRONTIER);
		/**
		 * Identity is derived from the room id, so each room has exactly one summary. The room id is not
		 * used directly because the server primary key is (owner, id) and the type does not carry that
		 * key (see summaryIdFor).
		 */
		expect(summary?.id).toBe(summaryIdFor(room.id));
		expect(summary?.epoch).toBe(0);
	});

	it("a deleted room's summary is not visible", async () => {
		const { db, store } = open(nextViewer("alice"));
		const room = await roomWith(store);
		await seedV2Summary(db, {
			roomId: room.id,
			summary: "The story so far.",
			frontier: FRONTIER,
		});

		await store.deleteRoom(room.id);
		expect(await store.getSummary(room.id)).toBeNull();
	});
});

describe("history rewrites", () => {
	it("a rewrite short of the frontier leaves the historical records alone", async () => {
		const { db, store } = open(nextViewer("alice"));
		const room = await roomWith(store);
		const messages = await conversation(store, room.id, 6);
		await seedV2Summary(db, {
			roomId: room.id,
			summary: "The story so far.",
			frontier: frontierAt(messages[1]),
		});
		await seedV2AutoMemory(db, {
			roomId: room.id,
			content: "Fact that must survive",
			originAt: messages[1].createdAt,
		});
		const before = await db.chatSummaries.get(summaryIdFor(room.id));

		// Only the last two lines are deleted, which is well past the frontier.
		await store.deleteFromMessage(messages[4].id);

		const summary = await store.getSummary(room.id);
		expect(summary?.summary).toBe("The story so far.");
		expect(summary?.epoch).toBe(0);
		/** No useless revision: an untouched summary must not become a push candidate on every edit. */
		expect(summary?.rev).toEqual(before?.rev);
		expect(await store.listMemories(room.id)).toHaveLength(1);
	});

	/**
	 * The store retires the summary by rewriting it, not by tombstoning it: the row stays live with an
	 * empty text, no frontier and a raised epoch. The epoch is what lets the retirement win the sync
	 * merge against a device still holding the old text (`chatSummarySyncCodec`).
	 */
	it("a rewrite reaching the frontier empties the summary and raises the epoch", async () => {
		const { db, store } = open(nextViewer("alice"));
		const room = await roomWith(store);
		const messages = await conversation(store, room.id, 6);
		await seedV2Summary(db, {
			roomId: room.id,
			summary: "Summary containing an event to be erased",
			frontier: frontierAt(messages[4]),
		});

		await store.deleteFromMessage(messages[2].id);

		const summary = await store.getSummary(room.id);
		expect(summary?.summary).toBe("");
		expect(summary?.frontier).toBeNull();
		expect(summary?.epoch).toBe(1);
		const raw = await db.chatSummaries.get(summaryIdFor(room.id));
		expect(raw?.deletedAt).toBeNull();
		/** The retirement is a local change the other devices must hear about. */
		expect(raw?.dirty).toBe(1);
	});

	it("a retired summary is not retired again by a later rewrite", async () => {
		const { db, store } = open(nextViewer("alice"));
		const room = await roomWith(store);
		const messages = await conversation(store, room.id, 6);
		await seedV2Summary(db, {
			roomId: room.id,
			summary: "The story so far.",
			frontier: frontierAt(messages[4]),
		});
		await store.deleteFromMessage(messages[4].id);
		const retired = await db.chatSummaries.get(summaryIdFor(room.id));

		await store.deleteFromMessage(messages[1].id);

		const after = await db.chatSummaries.get(summaryIdFor(room.id));
		expect(after?.epoch).toBe(1);
		expect(after?.rev).toEqual(retired?.rev);
	});

	/**
	 * Rewind precision: a summary is one text and is discarded whole, but memories carry origin times
	 * and rewind exactly. Without that asymmetry, one edit would wipe the room's entire long-term
	 * memory.
	 */
	it("deletes only auto memories from the vanished span; manual memories all stay", async () => {
		const { db, store } = open(nextViewer("alice"));
		const room = await roomWith(store);
		const messages = await conversation(store, room.id, 6);

		const manual = await store.createMemory({
			roomId: room.id,
			content: "Setting a person wrote down",
		});
		await seedV2AutoMemory(db, {
			roomId: room.id,
			content: "Surviving auto fact",
			originAt: messages[1].createdAt,
		});
		const vanishing = await seedV2AutoMemory(db, {
			roomId: room.id,
			content: "Auto fact to vanish",
			originAt: messages[4].createdAt,
		});
		/** No recorded origin: the rule cannot prove it predates the cut, so it goes too. */
		await seedV2AutoMemory(db, {
			roomId: room.id,
			content: "Auto fact of unknown origin",
			originAt: null,
		});

		await store.deleteFromMessage(messages[3].id);

		const memories = await store.listMemories(room.id);
		expect(memories.map((memory) => memory.content).sort()).toEqual([
			"Setting a person wrote down",
			"Surviving auto fact",
		]);
		expect(memories.some((memory) => memory.id === manual.id)).toBe(true);

		/** Deleting a row lets another device resurrect it on upload, so a tombstone must remain. */
		const raw = await db.chatMemories.get(vanishing.id);
		expect(raw?.deletedAt).not.toBeNull();
		expect(raw?.dirty).toBe(1);
	});

	/**
	 * The last line of defense for "the rewind never changes memories written by a person". An auto
	 * memory the person edited is promoted to theirs; deleting it on a rewind would erase a sentence
	 * the person just wrote.
	 */
	it("an auto memory a person promoted is not deleted by a rewind", async () => {
		const { db, store } = open(nextViewer("alice"));
		const room = await roomWith(store);
		const messages = await conversation(store, room.id, 4);
		const auto = await seedV2AutoMemory(db, {
			roomId: room.id,
			content: "Automatically extracted fact",
			originAt: messages[3].createdAt,
		});
		await store.updateMemory(
			auto.id,
			promoteMemoryPatch("Sentence a person edited"),
		);

		await store.deleteFromMessage(messages[1].id);

		const memories = await store.listMemories(room.id);
		expect(memories).toHaveLength(1);
		expect(memories[0].id).toBe(auto.id);
		expect(memories[0].content).toBe("Sentence a person edited");
		expect(memories[0].source).toBe("user");
	});

	it("a single deletion also goes through rewind", async () => {
		const { db, store } = open(nextViewer("alice"));
		const room = await roomWith(store);
		const messages = await conversation(store, room.id, 4);
		await seedV2Summary(db, {
			roomId: room.id,
			summary: "The story so far.",
			frontier: frontierAt(messages[3]),
		});
		await seedV2AutoMemory(db, {
			roomId: room.id,
			content: "Fact from the deleted line onward",
			originAt: messages[3].createdAt,
		});

		await store.deleteMessage(messages[1].id);

		expect((await store.getSummary(room.id))?.summary).toBe("");
		expect(await store.listMemories(room.id)).toEqual([]);
	});

	it("a message edit also goes through rewind", async () => {
		const { db, store } = open(nextViewer("alice"));
		const room = await roomWith(store);
		const messages = await conversation(store, room.id, 4);
		await seedV2Summary(db, {
			roomId: room.id,
			summary: "The story so far.",
			frontier: frontierAt(messages[3]),
		});
		await seedV2AutoMemory(db, {
			roomId: room.id,
			content: "Fact from the edited line onward",
			originAt: messages[3].createdAt,
		});

		// Index 2 is a user message; roles alternate starting from index 0.
		await store.editUserMessage(messages[2].id, "Rewritten utterance");

		expect((await store.getSummary(room.id))?.summary).toBe("");
		expect(await store.listMemories(room.id)).toEqual([]);
	});
});

describe("room deletion", () => {
	it("the summary is deleted along with it, without a revision bump", async () => {
		const { db, store } = open(nextViewer("alice"));
		const room = await roomWith(store);
		await seedV2Summary(db, {
			roomId: room.id,
			summary: "The story so far.",
			frontier: FRONTIER,
		});
		const auto = await seedV2AutoMemory(db, {
			roomId: room.id,
			content: "Auto fact",
			originAt: FRONTIER.createdAt,
		});

		const before = await db.chatSummaries.get(summaryIdFor(room.id));
		await store.deleteRoom(room.id);

		const after = await db.chatSummaries.get(summaryIdFor(room.id));
		expect(after?.deletedAt).not.toBeNull();
		/**
		 * A single tombstone on the room stands in for the whole subtree. If each child bumped its own
		 * revision, one delete would become several record pushes.
		 */
		expect(after?.rev).toEqual(before?.rev);
		expect((await db.chatMemories.get(auto.id))?.deletedAt).not.toBeNull();
	});
});

describe("isolation", () => {
	it("other rooms' summaries do not mix in", async () => {
		const { db, store } = open(nextViewer("alice"));
		const first = await roomWith(store);
		const second = await roomWith(store);

		await seedV2Summary(db, {
			roomId: first.id,
			summary: "The first room's story",
			frontier: FRONTIER,
		});

		expect((await store.getSummary(first.id))?.summary).toBe(
			"The first room's story",
		);
		expect(await store.getSummary(second.id)).toBeNull();
	});

	it("a rewind in one room does not touch another room's records", async () => {
		const { db, store } = open(nextViewer("alice"));
		const first = await roomWith(store);
		const second = await roomWith(store);
		const messages = await conversation(store, first.id, 4);
		await seedV2Summary(db, {
			roomId: second.id,
			summary: "The second room's story",
			frontier: frontierAt(messages[3]),
		});
		await seedV2AutoMemory(db, {
			roomId: second.id,
			content: "The second room's fact",
			originAt: messages[3].createdAt,
		});

		await store.deleteFromMessage(messages[0].id);

		expect((await store.getSummary(second.id))?.summary).toBe(
			"The second room's story",
		);
		expect(await store.listMemories(second.id)).toHaveLength(1);
	});

	/**
	 * Member isolation is enforced by address, not by a query condition: the database name is per
	 * member.
	 */
	it("another account's summaries and memories are not visible", async () => {
		const alice = open(nextViewer("alice"));
		const room = await roomWith(alice.store);
		await seedV2Summary(alice.db, {
			roomId: room.id,
			summary: "Alice's conversation",
			frontier: FRONTIER,
		});
		await seedV2AutoMemory(alice.db, {
			roomId: room.id,
			content: "Fact only Alice knows",
			originAt: FRONTIER.createdAt,
		});
		resetLocalDbScope();

		const bob = open(nextViewer("bob"));
		expect(await bob.store.getSummary(room.id)).toBeNull();
		expect(await bob.store.listMemories(room.id)).toEqual([]);
	});
});

describe("counting messages", () => {
	it("counts live messages only, per room", async () => {
		const { store } = open(nextViewer("alice"));
		const room = await roomWith(store);
		const other = await roomWith(store);
		const messages = await conversation(store, room.id, 5);
		await conversation(store, other.id, 2);

		expect(await store.countMessages(room.id)).toBe(5);

		/** Tombstones stay in the table; the count must not see them. */
		await store.deleteMessage(messages[0].id);
		await store.deleteFromMessage(messages[3].id);
		expect(await store.countMessages(room.id)).toBe(2);
		expect(await store.countMessages(other.id)).toBe(2);
	});

	it("an empty, deleted or missing room counts zero", async () => {
		const { store } = open(nextViewer("alice"));
		const empty = await roomWith(store);
		const room = await roomWith(store);
		await conversation(store, room.id, 3);

		expect(await store.countMessages(empty.id)).toBe(0);
		await store.deleteRoom(room.id);
		expect(await store.countMessages(room.id)).toBe(0);
		expect(await store.countMessages("no-such-room")).toBe(0);
	});
});
