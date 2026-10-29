import type {
	ChatMaintenancePlan,
	ChatSeed,
	ChatStore,
	ChatSummaryFrontier,
} from "@rowcat/chat";
import { promoteMemoryPatch, summaryIdFor } from "@rowcat/chat";
import { StoryChatSeedDto } from "@rowcat/contracts/chat";
import { afterEach, describe, expect, it } from "vitest";
import {
	activateLocalDbScope,
	type LocalDb,
	resetLocalDbScope,
} from "#/lib/local-data/db.ts";
import { createChatStore } from "./store.ts";

/**
 * Tests the maintenance store against real IndexedDB (fake-indexeddb). The pure rules are checked
 * by value in @rowcat/chat (memory-maintenance.test.ts). This file checks:
 * - summary, memories and frontier commit in one transaction
 * - nothing is written when the preconditions no longer hold
 * - the store does not trust the plan (memories promoted in the meantime)
 * - room deletion and history rewrites carry maintenance state along If any of these is wrong the
 *   screen still looks normal: the same range is reprocessed forever, a summary of a deleted
 *   exchange keeps entering the prompt, or a sentence the user just edited is overwritten.
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
const nextViewer = (label: string): string => `${label}-maint-${++sequence}`;

const open = (viewerId: string): ChatStore =>
	createChatStore(activateLocalDbScope(viewerId));

/** Tombstones are only visible through the raw table; the store port never returns deleted rows. */
const rawDb = (viewerId: string): LocalDb => activateLocalDbScope(viewerId);

afterEach(() => {
	resetLocalDbScope();
});

const roomWith = (store: ChatStore) =>
	store.createRoom({ originStoryId: "story-1", seed: seed() });

const FRONTIER: ChatSummaryFrontier = {
	createdAt: "2026-08-25T01:00:00.000Z",
	messageId: "m-60",
};

/**
 * A plan with a value under test. The `expect` argument matters: the store judges optimistic
 * concurrency against it, so a test can pass a wrong value to observe a rejection.
 */
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

describe("reading summaries", () => {
	it("a room that never ran has no summary", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);
		expect(await store.getSummary(room.id)).toBeNull();
	});

	it("reads the committed summary and frontier as is", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);

		expect(await store.applyMemoryMaintenance(plan(room.id))).toBe(true);

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
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);
		await store.applyMemoryMaintenance(plan(room.id));

		await store.deleteRoom(room.id);
		expect(await store.getSummary(room.id)).toBeNull();
	});
});

describe("commit", () => {
	it("summary, memories and frontier go together", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);

		expect(
			await store.applyMemoryMaintenance(
				plan(room.id, {
					operations: [
						{ type: "add", content: "Kai has the key." },
						{ type: "add", content: "The two agreed to meet at the station." },
					],
				}),
			),
		).toBe(true);

		const memories = await store.listMemories(room.id);
		expect(memories.map((memory) => memory.content).sort()).toEqual([
			"Kai has the key.",
			"The two agreed to meet at the station.",
		]);
		/** New memories are automatic, and their origin time is the end of this batch. */
		expect(memories.every((memory) => memory.source === "auto")).toBe(true);
		expect(
			memories.every((memory) => memory.originAt === FRONTIER.createdAt),
		).toBe(true);
		expect((await store.getSummary(room.id))?.frontier).toEqual(FRONTIER);
	});

	it("replacing an auto memory keeps its identity", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);
		await store.applyMemoryMaintenance(
			plan(room.id, {
				operations: [{ type: "add", content: "Kai has the key." }],
			}),
		);
		const [before] = await store.listMemories(room.id);

		await store.applyMemoryMaintenance(
			plan(room.id, {
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

		const after = await store.listMemories(room.id);
		expect(after).toHaveLength(1);
		/**
		 * Update in place instead of deleting and recreating: another device's merge would lose the basis
		 * for comparing the two versions.
		 */
		expect(after[0].id).toBe(before.id);
		expect(after[0].content).toBe("Kai gave the key to Yuna.");
		expect(after[0].originAt).toBe("2026-08-25T02:00:00.000Z");
	});

	it("removing an auto memory is a soft delete", async () => {
		const viewer = nextViewer("alice");
		const store = open(viewer);
		const room = await roomWith(store);
		await store.applyMemoryMaintenance(
			plan(room.id, {
				operations: [{ type: "add", content: "Passing fact" }],
			}),
		);
		const [created] = await store.listMemories(room.id);

		await store.applyMemoryMaintenance(
			plan(room.id, {
				expect: { epoch: 0, frontier: FRONTIER },
				operations: [{ type: "remove", memoryId: created.id }],
			}),
		);

		expect(await store.listMemories(room.id)).toEqual([]);
		/** Deleting a row lets another device resurrect it on upload, so a tombstone must remain. */
		const raw = await rawDb(viewer).chatMemories.get(created.id);
		expect(raw?.deletedAt).not.toBeNull();
		expect(raw?.dirty).toBe(1);
	});

	/**
	 * This assertion is the last line of defense for 'automatic maintenance never changes memories
	 * written by a person'. The pure plan already filters them, but the user may have promoted a
	 * memory after the plan was frozen. Deleting it then would erase a sentence the person just wrote.
	 */
	it("a memory promoted after the plan was fixed is left alone", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);
		await store.applyMemoryMaintenance(
			plan(room.id, {
				operations: [{ type: "add", content: "Automatically extracted fact" }],
			}),
		);
		const [auto] = await store.listMemories(room.id);

		// The user opened and edited the memory, so it is now the person's text.
		await store.updateMemory(
			auto.id,
			promoteMemoryPatch("Sentence a person edited"),
		);

		const applied = await store.applyMemoryMaintenance(
			plan(room.id, {
				expect: { epoch: 0, frontier: FRONTIER },
				operations: [
					{ type: "remove", memoryId: auto.id },
					{ type: "add", content: "New fact" },
				],
			}),
		);

		expect(applied).toBe(true);
		const memories = await store.listMemories(room.id);
		const survived = memories.find((memory) => memory.id === auto.id);
		expect(survived?.content).toBe("Sentence a person edited");
		expect(survived?.source).toBe("user");
		/** The other operations and the summary still commit; the whole plan is not rolled back. */
		expect(memories.map((memory) => memory.content)).toContain("New fact");
	});

	it("maintenance cannot delete a manual memory a person made", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);
		const manual = await store.createMemory({
			roomId: room.id,
			content: "Kai is left-handed.",
		});

		await store.applyMemoryMaintenance(
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

		const memories = await store.listMemories(room.id);
		expect(memories).toHaveLength(1);
		expect(memories[0].content).toBe("Kai is left-handed.");
		expect(memories[0].source).toBe("user");
	});

	it("does not commit to a deleted room", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);
		await store.deleteRoom(room.id);

		expect(await store.applyMemoryMaintenance(plan(room.id))).toBe(false);
	});
});

describe("optimistic concurrency", () => {
	/**
	 * Two maintenance runs read the same frontier and started together. The one that commits second
	 * writes nothing. Otherwise the same range's facts are stored twice and the frontier moves
	 * backward.
	 */
	it("refuses if the frontier advanced meanwhile", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);

		expect(await store.applyMemoryMaintenance(plan(room.id))).toBe(true);
		// The second run still expects `frontier: null`.
		expect(
			await store.applyMemoryMaintenance(
				plan(room.id, {
					summary: "Value that must not be overwritten",
					operations: [{ type: "add", content: "Duplicate fact" }],
				}),
			),
		).toBe(false);

		expect((await store.getSummary(room.id))?.summary).toBe(
			"The story so far.",
		);
		expect(await store.listMemories(room.id)).toEqual([]);
	});

	it("refuses if it was rewound meanwhile", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);
		const message = await store.appendMessage({
			roomId: room.id,
			role: "user",
			content: "Utterance to be erased",
		});

		await store.applyMemoryMaintenance(
			plan(room.id, {
				through: { createdAt: message.createdAt, messageId: message.id },
			}),
		);
		// Deleting that message makes the rewind bump the generation.
		await store.deleteFromMessage(message.id);

		const applied = await store.applyMemoryMaintenance(
			plan(room.id, {
				expect: {
					epoch: 0,
					frontier: { createdAt: message.createdAt, messageId: message.id },
				},
				summary: "Summary telling an erased conversation",
			}),
		);
		expect(applied).toBe(false);
		expect((await store.getSummary(room.id))?.summary).toBe("");
	});
});

describe("history rewrites", () => {
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

	it("a rewrite short of the frontier leaves maintenance state alone", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);
		const messages = await conversation(store, room.id, 6);

		await store.applyMemoryMaintenance(
			plan(room.id, {
				through: {
					createdAt: messages[1].createdAt,
					messageId: messages[1].id,
				},
				operations: [{ type: "add", content: "Fact that must survive" }],
			}),
		);

		// Only the last two lines are deleted, which is well past the frontier.
		await store.deleteFromMessage(messages[4].id);

		const summary = await store.getSummary(room.id);
		expect(summary?.summary).toBe("The story so far.");
		expect(summary?.epoch).toBe(0);
		expect(await store.listMemories(room.id)).toHaveLength(1);
	});

	it("a rewrite reaching the frontier drops the summary and raises the epoch", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);
		const messages = await conversation(store, room.id, 6);

		await store.applyMemoryMaintenance(
			plan(room.id, {
				through: {
					createdAt: messages[4].createdAt,
					messageId: messages[4].id,
				},
			}),
		);

		await store.deleteFromMessage(messages[2].id);

		const summary = await store.getSummary(room.id);
		expect(summary?.summary).toBe("");
		expect(summary?.frontier).toBeNull();
		expect(summary?.epoch).toBe(1);
	});

	/**
	 * Rewind precision: a summary is one text and is discarded whole, but memories carry origin times
	 * and rewind exactly. Without that asymmetry, one edit would wipe the room's entire long-term
	 * memory.
	 */
	it("deletes only auto memories from the vanished span; manual memories all stay", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);
		const messages = await conversation(store, room.id, 6);

		const manual = await store.createMemory({
			roomId: room.id,
			content: "Setting a person wrote down",
		});
		await store.applyMemoryMaintenance(
			plan(room.id, {
				through: {
					createdAt: messages[1].createdAt,
					messageId: messages[1].id,
				},
				operations: [{ type: "add", content: "Surviving auto fact" }],
			}),
		);
		await store.applyMemoryMaintenance(
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
				operations: [{ type: "add", content: "Auto fact to vanish" }],
			}),
		);

		await store.deleteFromMessage(messages[3].id);

		const memories = await store.listMemories(room.id);
		expect(memories.map((memory) => memory.content).sort()).toEqual([
			"Setting a person wrote down",
			"Surviving auto fact",
		]);
		expect(memories.some((memory) => memory.id === manual.id)).toBe(true);
	});

	it("a single deletion also goes through rewind", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);
		const messages = await conversation(store, room.id, 4);

		await store.applyMemoryMaintenance(
			plan(room.id, {
				through: {
					createdAt: messages[3].createdAt,
					messageId: messages[3].id,
				},
			}),
		);

		await store.deleteMessage(messages[1].id);
		expect((await store.getSummary(room.id))?.summary).toBe("");
	});

	it("a message edit also goes through rewind", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);
		const messages = await conversation(store, room.id, 4);

		await store.applyMemoryMaintenance(
			plan(room.id, {
				through: {
					createdAt: messages[3].createdAt,
					messageId: messages[3].id,
				},
			}),
		);

		// Index 2 is a user message; roles alternate starting from index 0.
		await store.editUserMessage(messages[2].id, "Rewritten utterance");
		expect((await store.getSummary(room.id))?.summary).toBe("");
	});
});

describe("room deletion", () => {
	it("the summary is deleted along with it, without a revision bump", async () => {
		const viewer = nextViewer("alice");
		const store = open(viewer);
		const room = await roomWith(store);
		await store.applyMemoryMaintenance(plan(room.id));

		const before = await rawDb(viewer).chatSummaries.get(summaryIdFor(room.id));
		await store.deleteRoom(room.id);

		const after = await rawDb(viewer).chatSummaries.get(summaryIdFor(room.id));
		expect(after?.deletedAt).not.toBeNull();
		/**
		 * A single tombstone on the room stands in for the whole subtree. If each child bumped its own
		 * revision, one delete would become several record pushes.
		 */
		expect(after?.rev).toEqual(before?.rev);
	});
});

describe("isolation", () => {
	it("other rooms' summaries do not mix in", async () => {
		const store = open(nextViewer("alice"));
		const first = await roomWith(store);
		const second = await roomWith(store);

		await store.applyMemoryMaintenance(
			plan(first.id, { summary: "The first room's story" }),
		);

		expect((await store.getSummary(first.id))?.summary).toBe(
			"The first room's story",
		);
		expect(await store.getSummary(second.id)).toBeNull();
	});

	/**
	 * Member isolation is enforced by address, not by a query condition: the database name is per
	 * member.
	 */
	it("another account's summaries are not visible", async () => {
		const alice = open(nextViewer("alice"));
		const room = await roomWith(alice);
		await alice.applyMemoryMaintenance(
			plan(room.id, {
				summary: "Alice's conversation",
				operations: [{ type: "add", content: "Fact only Alice knows" }],
			}),
		);
		resetLocalDbScope();

		const bob = open(nextViewer("bob"));
		expect(await bob.getSummary(room.id)).toBeNull();
		expect(await bob.listMemories(room.id)).toEqual([]);
	});
});
