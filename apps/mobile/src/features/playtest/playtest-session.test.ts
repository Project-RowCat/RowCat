import {
	createDraftStartSceneRecord,
	createStoryDraftRecord,
	type StoryPublicationSource,
} from "@rowcat/authoring";
import { EMPTY_GENERATION_PREFERENCE } from "@rowcat/chat";
import { describe, expect, it } from "vitest";
import {
	appendPlaytestAssistantMessage,
	appendPlaytestUserMessage,
	createPlaytestState,
	type PlaytestState,
	resetPlaytestConversation,
	selectPlaytestStartScene,
	setPlaytestPreference,
} from "./playtest-session.ts";

/**
 * The playtest session's **pure state model**: what creates a new identity and what does not.
 *
 * This file guards one rule: **a plain message append does not change the session identity; only
 * operations that discard the conversation do.** If that rule flips, the symptom is silent. If the
 * session object is rebuilt every turn, an in-flight generation loses its conversation and **cuts
 * itself off the moment the first response arrives**. On screen it looks like a response that
 * stopped partway.
 */

const NOW = "2026-01-01T00:00:00.000Z";
const REV = { t: 1_767_225_600_000, c: 0, d: "test-device" };
const stamp = (id: string) => ({ id, now: NOW, rev: REV });

const scene = (id: string, title: string, content: string) =>
	createDraftStartSceneRecord(
		{ draftId: "draft-1", position: 0, title, content },
		stamp(id),
	);

function source(
	over: {
		prompt?: string;
		scenes?: StoryPublicationSource["startScenes"];
	} = {},
): StoryPublicationSource {
	return {
		draft: createStoryDraftRecord(
			{
				title: "The Night Library",
				prompt: over.prompt ?? "A library where the books talk to you.",
			},
			stamp("draft-1"),
		),
		lore: [],
		startScenes: over.scenes ?? [],
		sceneImages: [],
	};
}

const open = (over: Parameters<typeof source>[0] = {}): PlaytestState =>
	createPlaytestState({ source: source(over), sessionId: "session-1" });

const talk = (state: PlaytestState): PlaytestState =>
	appendPlaytestAssistantMessage(
		appendPlaytestUserMessage(state, "Hi", { id: "m-1", now: NOW }),
		{ role: "assistant", content: "…meow.", model: "test/model" },
		{ id: "m-2", now: NOW },
	);

describe("opens a test", () => {
	it("the snapshot is assembled from the draft and the conversation is empty", () => {
		const state = open();
		expect(state.session.snapshot.draftId).toBe("draft-1");
		expect(state.session.snapshot.seed.scenario).toBe(
			"A library where the books talk to you.",
		);
		expect(state.messages).toEqual([]);
		expect(state.preference).toEqual(EMPTY_GENERATION_PREFERENCE);
		expect(state.startSceneId).toBeNull();
	});

	/** This value is stored nowhere, so the starting value must be an **empty override**. */
	it("it can open with inherited overrides", () => {
		const state = createPlaytestState({
			source: source(),
			sessionId: "session-9",
			preference: {
				responseLength: "long",
				target: null,
				reasoningEffort: null,
			},
		});
		expect(state.preference.responseLength).toBe("long");
	});
});

describe("appends messages", () => {
	/**
	 * **The session identity is unchanged.** This is the most important assertion in this file: if it
	 * flips, generation cuts itself off the moment the first response arrives.
	 */
	it("an ordinary append doesn't change the session object", () => {
		const state = open();
		const after = talk(state);

		expect(after.session).toBe(state.session);
		expect(after.messages.map((message) => message.content)).toEqual([
			"Hi",
			"…meow.",
		]);
	});

	/** The user utterance's speaker is **empty**; the assembler attaches the default name. */
	it("doesn't invent speaker names", () => {
		const [user] = talk(open()).messages;
		expect(user?.speaker).toBe("");
	});

	/** This line is never stored, so there is no place to fabricate sync metadata. */
	it("there's no sync metadata", () => {
		for (const message of talk(open()).messages)
			expect(Object.keys(message).sort()).not.toContain("rev");
	});

	it("the model rides only when the provider reported it", () => {
		const state = appendPlaytestAssistantMessage(
			open(),
			{ role: "assistant", content: "…" },
			{ id: "m-1", now: NOW },
		);
		expect(state.messages[0] && "model" in state.messages[0]).toBe(false);
	});
});

describe("Reset", () => {
	it("empties only the conversation and keeps the conditions", () => {
		const before = setPlaytestPreference(talk(open()), {
			responseLength: "short",
			target: null,
			reasoningEffort: null,
		});
		const after = resetPlaytestConversation(before, "session-2");

		expect(after.messages).toEqual([]);
		expect(after.session.snapshot).toBe(before.session.snapshot);
		expect(after.preference).toEqual(before.preference);
		expect(after.startSceneId).toBe(before.startSceneId);
		expect(after.source).toBe(before.source);
	});

	/** **The identity is freshly issued**; that is the whole of the race defence. */
	it("the session identity is new", () => {
		const before = talk(open());
		const after = resetPlaytestConversation(before, "session-2");
		expect(after.session).not.toBe(before.session);
		expect(after.session.id).toBe("session-2");
	});
});

describe("opening scene switch", () => {
	const scenes = [
		scene("scene-1", "Entrance", "This is the entrance."),
		scene("scene-2", "Rooftop", "This is the rooftop."),
	];

	it("the chosen scene becomes the opening and the conversation empties", () => {
		const before = talk(open({ scenes }));
		const after = selectPlaytestStartScene(before, "scene-2", "session-2");

		expect(after.session.snapshot.seed.firstScene).toBe("This is the rooftop.");
		expect(after.startSceneId).toBe("scene-2");
		expect(after.messages).toEqual([]);
		expect(after.session).not.toBe(before.session);
	});

	/**
	 * **The draft version is not re-read.** If changing a scene pulled in other edits, the user would
	 * see changes they never made take effect.
	 */
	it("uses the same draft version as is", () => {
		const before = open({ scenes });
		const after = selectPlaytestStartScene(before, "scene-1", "session-2");
		expect(after.source).toBe(before.source);
	});

	it("it can go back to the default opening", () => {
		const chosen = selectPlaytestStartScene(
			open({ scenes }),
			"scene-2",
			"session-2",
		);
		const back = selectPlaytestStartScene(chosen, null, "session-3");
		expect(back.startSceneId).toBeNull();
		expect(back.session.snapshot.seed.firstScene).toBe("This is the entrance.");
	});

	/**
	 * Pointing at a scene that no longer exists **does not throw**; it folds to the default opening.
	 * The selection is cleared too. If it were kept, the control would draw the missing scene as
	 * selected, and the screen would say something different from the opening actually loaded.
	 */
	it("a missing scene folds to the default opening and the selection empties", () => {
		const state = createPlaytestState({
			source: source({ scenes }),
			sessionId: "session-1",
			startSceneId: "scene-gone",
		});
		expect(state.startSceneId).toBeNull();
		expect(state.session.snapshot.seed.firstScene).toBe(
			"This is the entrance.",
		);
	});

	/** The draft does not change at all; this function does not know the store. */
	it("doesn't overwrite the draft's default opening setting", () => {
		const before = open({ scenes });
		const after = selectPlaytestStartScene(before, "scene-2", "session-2");
		expect(after.source.draft.defaultStartSceneId).toBe(
			before.source.draft.defaultStartSceneId,
		);
	});
});

describe("latest draft reload", () => {
	it("opens with the new version but inherits the playback-only conditions", () => {
		const scenes = [
			scene("scene-1", "Entrance", "This is the entrance."),
			scene("scene-2", "Rooftop", "This is the rooftop."),
		];
		const before = setPlaytestPreference(
			selectPlaytestStartScene(talk(open({ scenes })), "scene-2", "session-2"),
			{ responseLength: "long", target: null, reasoningEffort: null },
		);

		const after = createPlaytestState({
			source: source({ prompt: "Version B", scenes }),
			sessionId: "session-3",
			startSceneId: before.startSceneId,
			preference: before.preference,
		});

		expect(after.session.snapshot.seed.scenario).toBe("Version B");
		expect(after.messages).toEqual([]);
		expect(after.startSceneId).toBe("scene-2");
		expect(after.preference).toEqual(before.preference);
		expect(after.session).not.toBe(before.session);
	});
});

describe("generation overrides", () => {
	/** Changing the conditions is **not discarding the conversation**; it applies from the next response. */
	it("the conversation and session identity stay as they are", () => {
		const before = talk(open());
		const after = setPlaytestPreference(before, {
			responseLength: "short",
			target: null,
			reasoningEffort: null,
		});

		expect(after.session).toBe(before.session);
		expect(after.messages).toBe(before.messages);
		expect(after.preference.responseLength).toBe("short");
	});
});
