import { afterEach, describe, expect, it } from "vitest";
import {
	appendPlaytestAssistantMessage,
	appendPlaytestUserMessage,
	createPlaytestState,
} from "#/features/playtest/playtest-session.ts";
import { createAuthoringStore } from "#/lib/local-authoring/store.ts";
import { createChatStore } from "#/lib/local-chat/store.ts";
import {
	activateLocalDbScope,
	resetLocalDbScope,
} from "#/lib/local-data/db.ts";
import { syncCodecRegistry } from "#/lib/local-sync/registry.ts";
import { createDexieSyncStore } from "#/lib/local-sync/store.ts";

/**
 * Playtesting leaves nothing behind. This is verified by value against the real store.
 *
 * A static scan (`boundaries.test.ts`) already checks that the module is not imported, but that is
 * not enough. What must be checked is whether the store is unchanged after the full round trip.
 * Seed a draft, run one test pass, then inspect three places:
 * - `rooms`: empty. This is where the conversation list, sidebar, and recents read from.
 * - `messages`: empty. The conversation history.
 * - Outbound: only the draft. This is what the next push would upload.
 *
 * The last line matters most in this file. If the implementation created a room and hid it in the
 * UI, the first two checks would pass, but this one would not. Hiding is the screen's job; sync
 * does not look at the screen.
 */

const NOW = "2026-01-01T00:00:00.000Z";

let sequence = 0;
const nextViewer = (): string => `playtest-${++sequence}`;

afterEach(() => {
	resetLocalDbScope();
});

async function playthrough(viewerId: string) {
	const db = activateLocalDbScope(viewerId);
	const authoring = createAuthoringStore(db);

	const draft = await authoring.createDraft({
		title: "The Night Library",
		prompt: "A library where the books talk.",
	});
	await authoring.createLore(draft.id, {
		content: "The librarian is a cat.",
		constant: true,
	});
	await authoring.createStartScene(draft.id, {
		title: "Entrance",
		content: "It's the entrance.",
	});

	const source = await authoring.loadPublicationSource(draft.id);
	if (!source) throw new Error("couldn't read the draft just made");

	/**
	 * The draft as it was before the test ran. It is compared verbatim against the draft afterwards.
	 */
	const before = await authoring.getDraft(draft.id);

	let state = createPlaytestState({ source, sessionId: "session-1" });
	state = appendPlaytestUserMessage(state, "Hi, librarian.", {
		id: "m-1",
		now: NOW,
	});
	state = appendPlaytestAssistantMessage(
		state,
		{ role: "assistant", content: "…meow.", model: "test/model" },
		{ id: "m-2", now: NOW },
	);

	return { db, draft, before, state };
}

describe("the story test makes no conversation", () => {
	it("neither a room nor messages appear in the store", async () => {
		const viewerId = nextViewer();
		const { db, state } = await playthrough(viewerId);

		// Confirm first that the conversation actually ran. If nothing happened, the tests below would
		// pass vacuously.
		expect(state.messages).toHaveLength(2);

		const chat = createChatStore(db);
		expect(await chat.listRooms()).toEqual([]);
		/** Checks the raw tables, not only the list predicate, so no hidden rooms can remain. */
		expect(await db.rooms.count()).toBe(0);
		expect(await db.messages.count()).toBe(0);
	});

	/**
	 * Checks that the next push's upload set has no test conversation. An implementation that creates
	 * a room and hides it in the UI fails here, because such a record carries a dirty flag and gets
	 * collected.
	 */
	it("the test conversation is not among sync collection targets", async () => {
		const viewerId = nextViewer();
		const { db, draft } = await playthrough(viewerId);

		const sync = createDexieSyncStore(db, syncCodecRegistry);
		const batch = await sync.collectOutbound({ limit: 100, all: true });

		const types = new Set(batch.records.map((record) => record.type));
		expect(types.has("chat.room")).toBe(false);
		expect(types.has("chat.message")).toBe(false);
		expect(types.has("chat.memory")).toBe(false);

		/** Only the draft and its child records are uploaded. This holds regardless of the test. */
		expect([...types].sort()).toEqual([
			"authoring.draft",
			"authoring.lore",
			"authoring.scene",
		]);
		expect(
			batch.records.some(
				(record) => record.type === "authoring.draft" && record.id === draft.id,
			),
		).toBe(true);
	});

	/**
	 * The test does not touch a single field of the draft. The whole record is compared rather than
	 * selected fields, because selected fields would let the assertion pass silently when a new axis
	 * is added. This is especially true of `defaultStartSceneId` (a value that playtest selection must
	 * not overwrite) and `publishedStoryId` (the test must not leave a publish trace).
	 */
	it("leaves the draft record alone", async () => {
		const viewerId = nextViewer();
		const { db, draft, before } = await playthrough(viewerId);

		expect(await createAuthoringStore(db).getDraft(draft.id)).toEqual(before);
		expect(before?.publishedStoryId).toBeNull();
	});
});
