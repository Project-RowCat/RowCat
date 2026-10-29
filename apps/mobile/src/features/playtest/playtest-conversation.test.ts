import {
	createStoryDraftRecord,
	type StoryPublicationSource,
} from "@rowcat/authoring";
import { CHAT_HISTORY_LIMIT } from "@rowcat/chat";
import { describe, expect, it } from "vitest";
import { createPlaytestConversation } from "./playtest-conversation.ts";
import {
	createPlaytestState,
	type PlaytestStamp,
	type PlaytestState,
} from "./playtest-session.ts";

/**
 * Playtest adapter: what this conversation answers to the conversation runtime's questions.
 *
 * Because it is separated from the hook, these tests run the same object the screen uses. The first
 * group matters most: does a history read right after appending a user utterance see that
 * utterance? If the read used render state, the request would go out without the just-appended
 * line, and the model would reply without knowing what the user said. The bubble is still on
 * screen, so the cause would be hard to find.
 */

const NOW = "2026-01-01T00:00:00.000Z";
const REV = { t: 1_767_225_600_000, c: 0, d: "test-device" };

const source = (): StoryPublicationSource => ({
	draft: createStoryDraftRecord(
		{
			title: "The Night Library",
			prompt: "A library where the books talk to you.",
		},
		{ id: "draft-1", now: NOW, rev: REV },
	),
	lore: [],
	startScenes: [],
	sceneImages: [],
});

/**
 * Mimics the hook's wiring: the ref is updated first, render state follows.
 *
 * `rendered` deliberately lags behind. React re-renders in a task later than the microtask that
 * follows an append, so the harness reproduces that delay explicitly.
 */
function harness(initial: PlaytestState) {
	const ref = { current: initial };
	/** What the screen last drew. Deliberately left behind. */
	let rendered: PlaytestState = initial;
	let issued = 0;
	const stamp = (): PlaytestStamp => ({ id: `m-${++issued}`, now: NOW });

	const session = createPlaytestConversation({
		session: initial.session,
		read: () => ref.current,
		write: (next) => {
			ref.current = next(ref.current);
		},
		stamp,
	});

	return {
		session,
		state: () => ref.current,
		rendered: () => rendered,
		/** A late render commit. Called only when a test wants one. */
		commitRender: () => {
			rendered = ref.current;
		},
	};
}

const open = () =>
	harness(createPlaytestState({ source: source(), sessionId: "s-1" }));

describe("history right after appending the user line", () => {
	/**
	 * The most important assertion in this file. This is the order the pure turn actually runs (steps
	 * ① and ② in `generation-turn.ts`), and no React re-render happens in between.
	 */
	it("sees the line just appended — even before the render arrives", async () => {
		const test = open();

		await test.session.appendUserMessage("Hi, librarian.");
		const history = await test.session.loadHistory();

		expect(history.map((message) => message.content)).toEqual([
			"Hi, librarian.",
		]);
		/** The screen has not drawn that line yet, but the request still carries it. */
		expect(test.rendered().messages).toEqual([]);
	});

	it("the confirmed reply shows in the same place right away", async () => {
		const test = open();
		await test.session.appendUserMessage("Hi");
		await test.session.appendAssistantMessage({
			role: "assistant",
			content: "…meow.",
		});

		expect((await test.session.loadHistory()).map((m) => m.role)).toEqual([
			"user",
			"assistant",
		]);
	});

	/**
	 * The confirmed save returns the identity of its row.
	 *
	 * The observation layer needs to know which turn produced a response, and only the conversation
	 * that issued the identity can say so. If it stopped returning the id, the screen would fall back
	 * to assuming the last line belongs to the last turn. A late-finishing generation would break that
	 * assumption, and the inspector would attribute the response to a different turn's prompt.
	 */
	it("returns the confirmed reply's identity", async () => {
		const test = open();
		const id = await test.session.appendAssistantMessage({
			role: "assistant",
			content: "…meow.",
		});

		expect(typeof id).toBe("string");
		/** The ref is the source of truth. The render has not drawn that line yet, which is the point of this harness. */
		expect(test.state().messages.at(-1)?.id).toBe(id);
	});
});

describe("history window", () => {
	/**
	 * The same cap as a real conversation. A different value here would give long tests and long
	 * conversations different context, and this screen could then not reproduce playback after
	 * publishing.
	 */
	it("carries only up to the shared cap and keeps the recent ones", async () => {
		const test = open();
		for (let index = 0; index < CHAT_HISTORY_LIMIT + 5; index += 1)
			await test.session.appendUserMessage(`Line ${index}`);

		const history = await test.session.loadHistory();
		expect(history).toHaveLength(CHAT_HISTORY_LIMIT);
		expect(history.at(-1)?.content).toBe(`Line ${CHAT_HISTORY_LIMIT + 4}`);
	});
});

describe("what this conversation doesn't have", () => {
	/** There is no record to hold memories, so the assembler does not build a memory block at all. */
	it("memories are empty", async () => {
		expect(await open().session.loadMemories()).toEqual([]);
	});

	it("the summary is empty", async () => {
		expect(await open().session.loadSummary()).toBe("");
	});

	/**
	 * `maintain` is absent. If it existed, the pure turn would call it after the confirmed save, and
	 * the result of that paid call would be stored nowhere.
	 */
	it("there's no automatic maintenance port", () => {
		expect(open().session.maintain).toBeUndefined();
	});

	/**
	 * `extendAssistantMessage` is absent too. There is no record to append to, and the pure turn reads
	 * that absence so it does not silently start `Continue generating`.
	 */
	it("there's no append port", () => {
		expect(open().session.extendAssistantMessage).toBeUndefined();
	});
});

describe("runtime and identity", () => {
	it("the seed is the snapshot's and has no story id", () => {
		const test = open();
		expect(test.session.runtime.seed.scenario).toBe(
			"A library where the books talk to you.",
		);
		expect(Object.keys(test.session.runtime.seed)).not.toContain("storyId");
	});

	/** The rating comes from the draft. The viewer's entitlement is layered on top by the pure turn. */
	it("carries the story rating as is", () => {
		expect(open().session.runtime.adult).toBe(false);
	});

	/**
	 * **The token is the session object.** It does not change when messages are appended. If it did,
	 * an in-flight generation would lose its conversation on every turn and cut itself off at the
	 * first response.
	 */
	it("appending messages keeps the token", async () => {
		const test = open();
		const before = test.session.token;
		await test.session.appendUserMessage("Hi");
		expect(test.session.token).toBe(before);
	});
});

describe("overrides", () => {
	/** This layer answers only for the playtest-specific override. The global preference is read separately by the pure turn. */
	it("answers the temporary preferences in memory", async () => {
		const initial = createPlaytestState({
			source: source(),
			sessionId: "s-1",
			preference: {
				responseLength: "long",
				target: null,
				reasoningEffort: null,
			},
		});
		const test = harness(initial);
		expect(await test.session.loadPreference()).toEqual({
			responseLength: "long",
			target: null,
			reasoningEffort: null,
		});
	});
});
