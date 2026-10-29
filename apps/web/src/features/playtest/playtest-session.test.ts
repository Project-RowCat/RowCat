import {
	createStoryDraftRecord,
	type StoryPublicationSource,
} from "@rowcat/authoring";
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
 * State transitions of the playtest session: when the snapshot freezes and when it is rebuilt.
 *
 * If these rules are wrong, the symptom is silent. Changing the snapshot mid-conversation makes
 * accumulated history disagree with the current system prompt, and nothing on screen says so.
 * Responses just get odd, and the author blames their draft. The file runs without React, because
 * rendering would bury the rules under markup.
 */

const NOW = "2026-01-01T00:00:00.000Z";
const REV = { t: 1_767_225_600_000, c: 0, d: "test-device" };
const stamp = (id: string) => ({ id, now: NOW, rev: REV });

const sourceWith = (prompt: string): StoryPublicationSource => ({
	draft: createStoryDraftRecord(
		{ title: "The Night Library", prompt },
		stamp("draft-1"),
	),
	lore: [],
	startScenes: [],
	sceneImages: [],
});

const sceneRecord = (
	id: string,
	position: number,
	title: string,
	content: string,
) => ({
	id,
	draftId: "draft-1",
	position,
	title,
	content,
	createdAt: NOW,
	updatedAt: NOW,
	deletedAt: null,
	dirty: 1 as const,
	serverVersion: 0,
	rev: REV,
});

const open = (source: StoryPublicationSource, sessionId = "session-1") =>
	createPlaytestState({ source, sessionId });

const say = (state: PlaytestState, text: string, id: string) =>
	appendPlaytestUserMessage(state, text, { id, now: NOW });

/**
 * An in-progress test keeps its own version to the end.
 *
 * Even if another tab edits the draft, or the same screen changes conditions, an already-started
 * conversation's system prompt does not move. Real conversations behave that way: the room holds
 * the seed captured at acquisition, so editing the work does not change conversations already
 * started.
 */
describe("the snapshot freezes", () => {
	it("an open test sees the old version even after the draft changes", () => {
		let state = open(sourceWith("version A"));
		state = say(state, "hi", "m-1");

		const b = sourceWith("version B");
		expect(state.session.snapshot.seed.scenario).toBe("version A");

		// Only the operation that re-reads the draft moves the session to a new version.
		const reloaded = createPlaytestState({
			source: b,
			sessionId: "session-2",
			startSceneId: state.startSceneId,
			preference: state.preference,
		});
		expect(reloaded.session.snapshot.seed.scenario).toBe("version B");
		// The conversation is cleared at that point, so history from the old version is never carried
		// under a new prompt.
		expect(reloaded.messages).toEqual([]);
		expect(reloaded.session.id).not.toBe(state.session.id);
	});
});

describe("test reset", () => {
	it("empties only the conversation and keeps the snapshot and conditions", () => {
		let state = open(sourceWith("version A"));
		state = setPlaytestPreference(state, {
			responseLength: "long",
			target: null,
			reasoningEffort: null,
		});
		state = say(state, "hi", "m-1");

		const reset = resetPlaytestConversation(state, "session-2");

		expect(reset.messages).toEqual([]);
		expect(reset.session.snapshot).toBe(state.session.snapshot);
		expect(reset.preference).toEqual(state.preference);
		expect(reset.startSceneId).toBe(state.startSceneId);
	});

	/**
	 * Changing identity is the entirety of the race defense. A generation in progress holds the
	 * session object it started with. If that differs from the current session, its confirmed save
	 * cannot be reached (`features/conversation/generation-owner.ts`).
	 */
	it("issues a new session identity", () => {
		const state = open(sourceWith("version A"));
		const reset = resetPlaytestConversation(state, "session-2");
		expect(reset.session.id).toBe("session-2");
		expect(reset.session).not.toBe(state.session);
	});
});

describe("playback-only opening scene", () => {
	const source: StoryPublicationSource = {
		...sourceWith("version A"),
		startScenes: [
			sceneRecord("scene-1", 0, "Entrance", "It's the entrance."),
			sceneRecord("scene-2", 1, "Rooftop", "It's the rooftop."),
		],
	};

	it("keeps the same draft version, changes only the opening and empties the conversation", () => {
		let state = open(source);
		state = say(state, "hi", "m-1");
		expect(state.session.snapshot.seed.firstScene).toBe("It's the entrance.");

		const switched = selectPlaytestStartScene(state, "scene-2", "session-2");

		expect(switched.session.snapshot.seed.firstScene).toBe("It's the rooftop.");
		expect(switched.messages).toEqual([]);
		expect(switched.session.id).toBe("session-2");
		/** The draft version is unchanged: switching scenes does not pull in other edits. */
		expect(switched.source).toBe(state.source);
		expect(switched.preference).toEqual(state.preference);
	});

	it("reverting to the default clears the choice", () => {
		const state = selectPlaytestStartScene(open(source), "scene-2", "s2");
		const back = selectPlaytestStartScene(state, null, "s3");
		expect(back.startSceneId).toBeNull();
		expect(back.session.snapshot.seed.firstScene).toBe("It's the entrance.");
	});

	/**
	 * After another tab deleted the scene and the draft was re-read, the read does not throw. It falls
	 * back to the default opening, and the selection is cleared too. Keeping the selection would draw
	 * a control for a scene that is gone, and the screen would state something other than the opening
	 * actually rendered.
	 */
	it("reading a version without the chosen scene tidies the choice", () => {
		const state = selectPlaytestStartScene(open(source), "scene-2", "s2");
		const reloaded = createPlaytestState({
			source: {
				...source,
				startScenes: source.startScenes.filter((item) => item.id === "scene-1"),
			},
			sessionId: "s3",
			startSceneId: state.startSceneId,
			preference: state.preference,
		});
		expect(reloaded.startSceneId).toBeNull();
		expect(reloaded.session.snapshot.seed.firstScene).toBe(
			"It's the entrance.",
		);
	});
});

describe("messages", () => {
	it("user and assistant stack up in order", () => {
		let state = open(sourceWith("version A"));
		state = say(state, "hi", "m-1");
		state = appendPlaytestAssistantMessage(
			state,
			{ role: "assistant", content: "nice to meet you", model: "test/model" },
			{ id: "m-2", now: NOW },
		);

		expect(state.messages.map((m) => [m.role, m.content])).toEqual([
			["user", "hi"],
			["assistant", "nice to meet you"],
		]);
		expect(state.messages[1]?.model).toBe("test/model");
	});

	/**
	 * Attaching messages does not change session identity, and this assertion protects the behavior of
	 * the whole screen. If the session object were recreated per message, the ownership check would be
	 * false on every turn, and an in-progress generation would cancel itself the moment its first
	 * response arrived, so no conversation would ever complete.
	 *
	 * Hence the conversation lives outside the session. The session holds only the parts that are
	 * frozen: identity and snapshot.
	 */
	it("appending keeps the same session object", () => {
		const before = open(sourceWith("version A"));
		const after = appendPlaytestAssistantMessage(
			say(before, "hi", "m-1"),
			{ role: "assistant", content: "nice to meet you" },
			{ id: "m-2", now: NOW },
		);
		expect(after.session).toBe(before.session);
		expect(after.messages).toHaveLength(2);
	});

	/**
	 * An interrupted response keeps its content, matching the real conversation. The user has already
	 * read those characters, and deleting them would make text vanish from the screen.
	 */
	it("a cut reply keeps only the marker and its content stays", () => {
		const state = appendPlaytestAssistantMessage(
			open(sourceWith("version A")),
			{ role: "assistant", content: "up to here", incomplete: true },
			{ id: "m-1", now: NOW },
		);
		expect(state.messages[0]).toMatchObject({
			content: "up to here",
			incomplete: true,
		});
	});

	/**
	 * Does not invent sync metadata. The key set shows that no path exists for this record to flow to
	 * storage: there is no `dirty`, `rev`, `serverVersion`, tombstone, or room id.
	 */
	it("has no persistence axis", () => {
		const state = say(open(sourceWith("version A")), "hi", "m-1");
		expect(Object.keys(state.messages[0] ?? {}).sort()).toEqual([
			"content",
			"createdAt",
			"id",
			"role",
			"speaker",
		]);
	});
});
