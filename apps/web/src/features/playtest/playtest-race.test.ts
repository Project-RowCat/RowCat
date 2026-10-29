import {
	createStoryDraftRecord,
	type StoryPublicationSource,
} from "@rowcat/authoring";
import { describe, expect, it } from "vitest";
import {
	canPersistGeneration,
	type GenerationOwner,
} from "#/features/conversation/generation-owner.ts";
import {
	appendPlaytestAssistantMessage,
	createPlaytestState,
	type PlaytestState,
	resetPlaytestConversation,
	selectPlaytestStartScene,
} from "./playtest-session.ts";

/**
 * Verifies that a late-finishing generation cannot attach its answer to the next test (P0). The
 * author may press reset or 'new test from latest draft' mid-response. An abort signal is only a
 * signal: a request whose body has fully arrived still completes normally, so its save arrives as
 * success, and a check on abort alone would let it through.
 *
 * The defense uses two axes. This file checks the session object's identity with the same ownership
 * function the chat screen uses. The history-epoch axis is faster, because the session identity
 * reaches the hook only after React re-renders, while the epoch is raised synchronously. The last
 * describe block checks that axis too.
 *
 * The test runs without React, reproducing the hook's three steps in order: capture ownership at
 * generation start, let an operation replace the session, then persist a late commit only if
 * ownership still matches.
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

function scene(prompt = "version A") {
	const viewerId = "alice";
	let state: PlaytestState = createPlaytestState({
		source: sourceWith(prompt),
		sessionId: "session-1",
	});

	// Generation starts here. The session identity is fixed at this point.
	const owner: GenerationOwner = {
		viewerId,
		session: state.session,
		historyEpoch: 0,
	};

	/** A late confirmed save. It passes the same guard as the hook's commit block. */
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
	it("cannot attach the answer to the new test", () => {
		const test = scene();

		test.reset();
		expect(test.lateCommit("answer to a question before the reset")).toBe(
			false,
		);
		expect(test.contents()).toEqual([]);
	});

	it("without a reset it attaches as usual; the defense is not overeager", () => {
		const test = scene();
		expect(test.lateCommit("normal reply")).toBe(true);
		expect(test.contents()).toEqual(["normal reply"]);
	});
});

describe("a generation finishing during a draft reload", () => {
	/**
	 * Session A started generating from draft A. The author then opened a new test from the latest
	 * draft (B). A's response was not built from B's prompt, so it must not attach to B's
	 * conversation.
	 */
	it("version A's reply does not enter version B's conversation", () => {
		const test = scene("version A");

		test.reload("version B");
		expect(test.state.session.snapshot.seed.scenario).toBe("version B");
		expect(test.lateCommit("answer made from version A")).toBe(false);
		expect(test.contents()).toEqual([]);
	});
});

describe("a generation finishing during an opening switch", () => {
	it("no answer attaches to a conversation started with another opening", () => {
		const test = scene();
		test.selectScene(null);
		expect(test.lateCommit("answer made with the old opening")).toBe(false);
		expect(test.contents()).toEqual([]);
	});
});

describe("a generation finishing during an account switch", () => {
	/**
	 * The path where the session object stays the same but the member changes. If only one axis were
	 * checked, this case would pass, and Alice's response would appear on Bob's screen.
	 */
	it("does not attach when the member changes", () => {
		const test = scene();
		expect(
			canPersistGeneration(
				test.owner,
				{ viewerId: "bob", session: test.state.session },
				0,
			),
		).toBe(false);
	});
});

/**
 * Once the epoch has moved, a late response is blocked regardless of session identity, and this
 * check arrives first.
 *
 * This reproduces the window just after reset, when React has not yet re-rendered and the session
 * object is still the same. If only one of the two axes existed, a late response would pass here.
 */
describe("history version", () => {
	it("does not attach when the version rises, even with the same session", () => {
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
