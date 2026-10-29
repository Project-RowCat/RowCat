import { EMPTY_GENERATION_PREFERENCE } from "@rowcat/chat";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LocalScopeController } from "../../lib/local-data/activation.ts";
import {
	createMemorySecureStorage,
	createTempDirectory,
	createTestScopeController,
} from "../../test/sqlite-node.ts";
import {
	appendPlaytestAssistantMessage,
	appendPlaytestUserMessage,
	createPlaytestState,
	setPlaytestPreference,
} from "./playtest-session.ts";

/**
 * **A playtest leaves nothing behind**, verified by value on real SQLite.
 *
 * The static scan (`playtest-boundaries.test.ts`) guarantees the module is never imported, but that
 * alone is not enough. What must hold is that **the store is unchanged after a full round trip**.
 * Four places answer that after seeding a draft and running one playthrough:
 *
 * ```text
 * rooms       empty        where the conversation list and the drawer's recent rooms read
 * messages    empty        conversation history
 * outbound    draft only   what the next push uploads
 * draft       unchanged    the test never touches the manuscript
 * ```
 *
 * The third line matters most here. A design that created a room and hid it on screen would pass
 * the first two lines but not this one: hiding is the screen's job, and sync never looks at the
 * screen.
 *
 * `node:sqlite` is plugged into the same driver port, so the adapter's SQL actually runs
 * (`src/test/sqlite-node.ts`).
 */

let temp: ReturnType<typeof createTempDirectory>;
let controller: LocalScopeController;

const storage = createMemorySecureStorage();

beforeEach(() => {
	temp = createTempDirectory();
	controller = createTestScopeController(temp.path, storage);
});

afterEach(async () => {
	await controller.release();
	temp.dispose();
});

const NOW = "2026-01-01T00:00:00.000Z";

/** Seeds one draft and runs one playthrough on that version. */
async function playthrough(viewerId: string) {
	const scope = await controller.activate(viewerId);
	const authoring = scope.stores.authoring;

	const draft = await authoring.createDraft({
		title: "The Night Library",
		prompt: "A library where the books talk to you.",
	});
	await authoring.createLore(draft.id, {
		content: "The librarian is a cat.",
		constant: true,
	});
	await authoring.createStartScene(draft.id, {
		title: "Entrance",
		content: "This is the entrance.",
	});

	const source = await authoring.loadPublicationSource(draft.id);
	if (!source) throw new Error("couldn't read the draft just made");

	/** The draft as it was just before the playthrough. Compared against this value below. */
	const before = await authoring.getDraft(draft.id);

	// One playthrough: one user utterance and one committed response.
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

	return { scope, draft, before, state };
}

describe("a story test doesn't create a conversation", () => {
	it("neither rooms nor messages appear in storage", async () => {
		const { scope, state } = await playthrough("alice");

		// Confirm the conversation actually ran; if nothing happened, this test is vacuous.
		expect(state.messages).toHaveLength(2);

		const chat = scope.stores.chat;
		expect(await chat.listRooms()).toEqual([]);
	});

	/**
	 * **The next push's upload list has no test conversation.** An implementation that creates the
	 * room and hides it on screen fails here: such a record carries `dirty` and is collected as-is.
	 */
	it("the sync collection has no test conversation", async () => {
		const { scope, draft } = await playthrough("alice");

		const batch = await scope.stores.sync.collectOutbound({
			limit: 100,
			all: true,
		});

		const types = new Set(batch.records.map((record) => record.type));
		expect(types.has("chat.room")).toBe(false);
		expect(types.has("chat.message")).toBe(false);
		expect(types.has("chat.memory")).toBe(false);
		/** Also checks that no playtest-only record type exists. */
		for (const type of types) expect(type.startsWith("playtest")).toBe(false);

		/** Only the draft and its children go up; that holds regardless of the test. */
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
	 * The test **never touches the draft.** The whole record is compared rather than picked fields,
	 * because a hand-picked field list silently passes when a new axis is added. This matters most for
	 * `defaultStartSceneId` (a playtest-only selection must not overwrite it) and `publishedStoryId`
	 * (a test must not leave a publish trace).
	 */
	it("doesn't touch the draft record", async () => {
		const { scope, draft, before } = await playthrough("alice");

		expect(await scope.stores.authoring.getDraft(draft.id)).toEqual(before);
		expect(before?.publishedStoryId).toBeNull();
	});

	/**
	 * **Temporary generation overrides do not leak into device preferences.**
	 *
	 * Changing the model or response length during a test must not change the person's **default for
	 * every conversation**. The pure model already guarantees this structurally
	 * (`setPlaytestPreference` does not know the store), but here we check that the device preference
	 * is still empty after the round trip. If a line calling `setGlobal` ever appears somewhere, this
	 * assertion breaks first.
	 */
	it("temporary overrides aren't saved to device preferences", async () => {
		const { scope, state } = await playthrough("alice");
		const withOverride = setPlaytestPreference(state, {
			responseLength: "long",
			target: { provider: "rowcat", model: "claude-sonnet-5" },
			reasoningEffort: null,
		});
		expect(withOverride.preference.responseLength).toBe("long");

		expect(await scope.stores.generation.getGlobal()).toEqual(
			EMPTY_GENERATION_PREFERENCE,
		);
	});
});

describe("account isolation", () => {
	/**
	 * Alice's test leaves no trace in Bob's store. The per-member file already has that property, but
	 * if the playtest session starts writing somewhere, the writes would land in that file.
	 */
	it("Bob's storage has nothing", async () => {
		await playthrough("alice");

		const bob = await controller.activate("bob");
		expect(await bob.stores.chat.listRooms()).toEqual([]);
		expect(await bob.stores.authoring.listDrafts()).toEqual([]);
		const batch = await bob.stores.sync.collectOutbound({
			limit: 100,
			all: true,
		});
		expect(batch.records).toEqual([]);
	});
});
