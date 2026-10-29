import {
	createStoryDraftRecord,
	type StoryPublicationSource,
} from "@rowcat/authoring";
import { canPersistGeneration, type GenerationOwner } from "@rowcat/chat";
import { describe, expect, it } from "vitest";
import {
	appendPlaytestAssistantMessage,
	createPlaytestState,
	type PlaytestState,
	resetPlaytestConversation,
	selectPlaytestStartScene,
} from "./playtest-session.ts";

/**
 * **A late generation cannot attach its answer to the next test** (P0).
 *
 * This order is common: while a response is still streaming, the creator presses `Reset test` or `New test
 * from latest draft`. The provider request is already out, and **an abort signal is only a signal: a
 * request that has received its whole body finishes normally.** The confirming save on that path
 * arrives as a success, not a failure, so code that only checks "was it aborted" lets it through.
 *
 * There are two defence axes, and this test checks **the session object's identity** and **the
 * history epoch**. The conversation screen does the same job with the store instance
 * (`features/chat/messages/history-rewrite.test.ts`). Here the same decision function runs against
 * the playtest session, so both conversations share one race defence.
 *
 * Runs without React. The hook's job summarizes into three steps, and this test reproduces them in
 * the same order:
 *
 * ```text
 * 1. generation starts   owner = { viewerId, session: current session object, historyEpoch }
 * 2. an operation        reset, reload and scene switch create a **new session object**
 * 3. late commit         attaches only when canPersistGeneration(owner, current key, epoch) is true
 * ```
 */

const NOW = "2026-01-01T00:00:00.000Z";
const REV = { t: 1_767_225_600_000, c: 0, d: "test-device" };

const sourceWith = (prompt: string): StoryPublicationSource => ({
	draft: createStoryDraftRecord(
		{ title: "The Night Library", prompt },
		{ id: "draft-1", now: NOW, rev: REV },
	),
	lore: [],
	startScenes: [],
	sceneImages: [],
});

/** One playtest and one generation turn running on top of it. */
function scene(prompt = "Version A") {
	const viewerId = "alice";
	let state: PlaytestState = createPlaytestState({
		source: sourceWith(prompt),
		sessionId: "session-1",
	});

	// ① Generation starts. The session identity at this point is fixed.
	const owner: GenerationOwner = {
		viewerId,
		session: state.session,
		historyEpoch: 0,
	};

	/** ③ A late committed save. It passes the **same condition** as the hook's commit block. */
	const lateCommit = (content: string): boolean => {
		const key = { viewerId, session: state.session };
		if (!canPersistGeneration(owner, key, 0)) return false;
		state = appendPlaytestAssistantMessage(
			state,
			{ role: "assistant", content },
			{ id: "late", now: NOW },
		);
		return true;
	};

	return {
		get state() {
			return state;
		},
		owner,
		lateCommit,
		reset: () => {
			state = resetPlaytestConversation(state, "session-2");
		},
		reload: (nextPrompt: string) => {
			state = createPlaytestState({
				source: sourceWith(nextPrompt),
				sessionId: "session-3",
				startSceneId: state.startSceneId,
				preference: state.preference,
			});
		},
		selectScene: (id: string | null) => {
			state = selectPlaytestStartScene(state, id, "session-4");
		},
		contents: () => state.messages.map((message) => message.content),
	};
}

describe("a generation finishing during reset", () => {
	it("can't attach an answer to the new test", () => {
		const test = scene();

		test.reset();
		expect(
			test.lateCommit("An answer to a question from before the reset"),
		).toBe(false);
		expect(test.contents()).toEqual([]);
	});

	it("without a reset it attaches as is — the defence isn't excessive", () => {
		const test = scene();
		expect(test.lateCommit("A normal reply")).toBe(true);
		expect(test.contents()).toEqual(["A normal reply"]);
	});
});

describe("a generation finishing during draft reload", () => {
	/**
	 * Session A started generating on version A, and in the meantime the creator opened a new test
	 * from the latest draft (version B). A's response was **not built from B's prompt**, so it must
	 * not attach.
	 */
	it("version A's reply doesn't enter version B's conversation", () => {
		const test = scene("Version A");

		test.reload("Version B");
		expect(test.state.session.snapshot.seed.scenario).toBe("Version B");
		expect(test.lateCommit("An answer made from version A")).toBe(false);
		expect(test.contents()).toEqual([]);
	});
});

describe("a generation finishing during an opening scene switch", () => {
	it("the answer doesn't attach to a conversation started with another opening", () => {
		const test = scene();
		test.selectScene(null);
		expect(test.lateCommit("An answer made from the old opening")).toBe(false);
		expect(test.contents()).toEqual([]);
	});
});

describe("a generation finishing during an account switch", () => {
	/**
	 * The path where the session object is unchanged but the member has changed. If both axes are not
	 * checked, this passes, and Alice's response appears on Bob's screen.
	 */
	it("doesn't attach when the member changes", () => {
		const test = scene();
		expect(
			canPersistGeneration(
				test.owner,
				{ viewerId: "bob", session: test.state.session },
				0,
			),
		).toBe(false);
	});

	/** Signing out (guest) is the same case: that account's database is already closed. */
	it("doesn't attach when dropping to guest either", () => {
		const test = scene();
		expect(
			canPersistGeneration(
				test.owner,
				{ viewerId: null, session: test.state.session },
				0,
			),
		).toBe(false);
	});
});

/**
 * **Raising the history epoch blocks the late answer regardless of session identity**, and this
 * check arrives first.
 *
 * It reproduces the window right after a reset, when React has not yet re-rendered and the session
 * object is still the same. With only one of the two axes, a late response would pass here. In this
 * app the only place that raises the epoch is `rewriteHistory` in `use-chat-generation.ts`, and all
 * three operations on the playtest screen pass through that gate (`discardConversation` in
 * `use-playtest.ts`).
 */
describe("history version", () => {
	it("doesn't attach when the version rises even with the same session", () => {
		const test = scene();
		expect(
			canPersistGeneration(
				test.owner,
				{ viewerId: "alice", session: test.state.session },
				test.owner.historyEpoch + 1,
			),
		).toBe(false);
	});
});
