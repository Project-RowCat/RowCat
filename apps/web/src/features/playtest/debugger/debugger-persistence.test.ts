import {
	buildChatGenerationRequestTraced,
	createConversationDebugStore,
	safeChatRequestDebug,
} from "@rowcat/chat";
import { afterEach, describe, expect, it } from "vitest";
import { createPlaytestState } from "#/features/playtest/playtest-session.ts";
import { createAuthoringStore } from "#/lib/local-authoring/store.ts";
import { createChatStore } from "#/lib/local-chat/store.ts";
import {
	activateLocalDbScope,
	resetLocalDbScope,
} from "#/lib/local-data/db.ts";
import { syncCodecRegistry } from "#/lib/local-sync/registry.ts";
import { createDexieSyncStore } from "#/lib/local-sync/store.ts";

/**
 * Turning the debugger on leaves nothing behind. This is checked by value against real storage. A
 * static scan only proves the module is not imported; what must be verified is that storage is
 * unchanged after a full turn is recorded. The test plants a draft, assembles a prompt, records it,
 * then inspects:
 * - rooms: empty (the debugger creates no room)
 * - messages: empty (records are not messages)
 * - outbound: only the draft (the next push sends it; observation is not queued here) The draft
 *   record itself must not change. Records do contain the full prompt text, which is the point of
 *   the feature, but that value is read, not written.
 */

let sequence = 0;
const nextViewer = (): string => `playtest-debug-${++sequence}`;

afterEach(() => {
	resetLocalDbScope();
});

describe("the debugger stores nothing", () => {
	it("recording a whole turn leaves the store unchanged", async () => {
		const db = activateLocalDbScope(nextViewer());
		const authoring = createAuthoringStore(db);

		const draft = await authoring.createDraft({
			title: "The Night Library",
			prompt: "A library where the books talk.",
		});
		await authoring.createLore(draft.id, {
			content: "The librarian is a cat.",
			constant: true,
		});
		const source = await authoring.loadPublicationSource(draft.id);
		if (!source) throw new Error("couldn't read the draft just made");
		const before = await authoring.getDraft(draft.id);

		const state = createPlaytestState({ source, sessionId: "session-1" });
		const store = createConversationDebugStore({
			now: () => 1,
			newTurnId: () => "turn-1",
		});

		/** Records a value that passed the real assembler, so the assertions below are not vacuous. */
		const assembled = buildChatGenerationRequestTraced({
			room: { seed: state.session.snapshot.seed },
			messages: [],
			allAges: true,
			userInput: "Hi, librarian.",
		});
		const turnId = store.beginTurn("send");
		store.emit({ kind: "input-accepted", turnId, data: { characters: 7 } });
		store.emit({
			kind: "prompt-assembled",
			turnId,
			data: {
				prompt: assembled.trace,
				request: safeChatRequestDebug(assembled.request),
			},
		});
		store.emit({
			kind: "turn-committed",
			turnId,
			data: { messageId: "m-1" },
		});

		/**
		 * First confirm that the record has content. If it is empty, the assertions below are vacuous.
		 */
		expect(store.getState().turns[0]?.prompt?.blocks.length).toBeGreaterThan(0);
		expect(store.getState().turns[0]?.prompt?.lore).toHaveLength(1);

		const chat = createChatStore(db);
		expect(await chat.listRooms()).toEqual([]);
		expect(await db.rooms.count()).toBe(0);
		expect(await db.messages.count()).toBe(0);

		const sync = createDexieSyncStore(db, syncCodecRegistry);
		const batch = await sync.collectOutbound({ limit: 100, all: true });
		expect(
			[...new Set(batch.records.map((record) => record.type))].sort(),
		).toEqual(["authoring.draft", "authoring.lore"]);

		expect(await authoring.getDraft(draft.id)).toEqual(before);
	});
});
