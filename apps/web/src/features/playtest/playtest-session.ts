import type {
	PlaytestSnapshot,
	StoryPublicationSource,
} from "@rowcat/authoring";
import { buildPlaytestSnapshot } from "@rowcat/authoring";
import type {
	GeneratedAssistantMessage,
	GenerationPreference,
} from "@rowcat/chat";
import { EMPTY_GENERATION_PREFERENCE } from "@rowcat/chat";
import type { ConversationDisplayMessage } from "#/features/conversation/message.ts";

/**
 * Playtest state lives in memory only. Nothing here is written to IndexedDB, SQLite, localStorage,
 * or the sync codec registry, and a refresh clearing it is intended. Playtest conversations are
 * working traces, not product data. Persisting them (for example via ChatStore.createRoom() and
 * hiding them in the list) would make the dirty, revision, and tombstone metadata ride along on the
 * next push, since sync does not look at the screen.
 *
 * Every function here is pure and builds a new object instead of mutating a session. Session
 * identity is the ownership axis (features/conversation/generation-owner.ts), so a reset or reload
 * that replaces the object makes an in-flight generation lose its conversation.
 */

/**
 * A replayed message line, not a ChatMessage. It has no sync metadata (dirty, rev, serverVersion),
 * no tombstone, and no room identity. That absence expresses that the value is never persisted, so
 * it cannot leak into storage by accident.
 */
export interface PlaytestMessage extends ConversationDisplayMessage {
	/**
	 * Not used for display; the time is not rendered. It records that message order is deterministic.
	 */
	createdAt: string;
	/** The model that actually produced the response. Set only when the provider reports it. */
	model?: string;
}

/**
 * Only the stable parts of a playtest live here: identity and snapshot. The conversation is kept
 * out on purpose. The reference identity of this object is the ownership axis
 * (features/conversation/generation-owner.ts). If a new object were created per message, an
 * in-flight generation would cut itself off at the first response.
 *
 * A new object is created only on reset, start-scene change, or reload of the latest draft. In all
 * three cases the user is discarding the current conversation. The id is never shown; it exists so
 * identity can also be compared by value.
 */
export interface PlaytestSession {
	id: string;
	snapshot: PlaytestSnapshot;
}

/**
 * The whole playtest that is currently open. Keeping `source` here is the most important decision
 * in this type. Rebuilding the snapshot on a start-scene change must not re-read storage; otherwise
 * a draft edited in another tab would silently flow in, and the user would see changes they did not
 * make.
 *
 * The only operation that re-reads the draft has its own name: `New test from latest draft`.
 */
/**
 * How this test was opened. The observation log's first line records this value. It lives in state
 * rather than on the session object because the session's reference identity is the ownership axis.
 * Adding a field there would break the promise that PlaytestSession holds only the stable parts.
 *
 * The value belongs to the new session. If reset left a 'cleared' record on the old session, that
 * record would go to storage nobody reads (storage is recreated with the session), and the new
 * session's log could not say how it started.
 */
export type PlaytestSessionOrigin =
	| "opened"
	/** Cleared only the conversation, under the same conditions. */
	| "reset"
	/** Re-read the latest draft. The manuscript may have changed. */
	| "reloaded"
	| "scene-changed";

export interface PlaytestState {
	/**
	 * The draft revision this test was loaded from. It is not re-read here (see the PlaytestState
	 * header).
	 */
	source: StoryPublicationSource;
	/**
	 * The stable part. If this object changes, an in-flight generation can no longer write anything.
	 */
	session: PlaytestSession;
	/**
	 * The conversation accumulated on top. Messages are appended without changing `session`, which
	 * stays the same object (see above).
	 */
	messages: PlaytestMessage[];
	/** Playtest-only start scene selection. `null` means the draft's default opening. */
	startSceneId: string | null;
	/**
	 * Generation overrides used only in this test. They are stored neither in the draft nor in device
	 * preferences.
	 *
	 * The draft does not hold `model` or `responseLength` because they are not authoring properties:
	 * the model belongs to the device or account, and a work can be played with any model. They are
	 * not written to the global preference either, because one test should not change the user's
	 * default for every conversation. So they live here, only as long as the screen does.
	 */
	preference: GenerationPreference;
	/**
	 * How this session was opened. Not shown on screen; the first line of the observation log reads
	 * it.
	 */
	sessionOrigin: PlaytestSessionOrigin;
}

/**
 * Values supplied by the caller when a record is created: identity and time. Passing them in keeps
 * the functions pure.
 */
export interface PlaytestStamp {
	id: string;
	/** ISO 8601. */
	now: string;
}

/**
 * Opens a playtest from one draft revision. The snapshot is built once here and never changes
 * afterward. If the system prompt changed mid-conversation, nobody could say what was being tested.
 * A real conversation likewise keeps the seed it had when acquired.
 */
export function createPlaytestState(input: {
	source: StoryPublicationSource;
	sessionId: string;
	/** Playtest-only selection to carry over. Pass it only on a reload, not for a new test. */
	startSceneId?: string | null;
	preference?: GenerationPreference;
	/** Defaults to `opened`. A caller that reloads passes its own origin. */
	origin?: PlaytestSessionOrigin;
}): PlaytestState {
	const requested = input.startSceneId ?? null;
	const snapshot = buildPlaytestSnapshot(input.source, {
		startSceneId: requested,
	});
	/**
	 * If the chosen scene is not in this revision (it was deleted between reloads), the snapshot has
	 * already fallen back to the default opening. The selection is cleared to match that fact. Keeping
	 * it would make the control show a scene that does not exist, and the screen would say something
	 * different from the opening actually loaded.
	 */
	const startSceneId =
		requested !== null &&
		snapshot.startScenes.some((scene) => scene.id === requested)
			? requested
			: null;

	return {
		source: input.source,
		session: { id: input.sessionId, snapshot },
		messages: [],
		startSceneId,
		preference: input.preference ?? EMPTY_GENERATION_PREFERENCE,
		sessionOrigin: input.origin ?? "opened",
	};
}

/**
 * Clears only the conversation. The snapshot, start scene, and generation overrides are kept.
 *
 * This is kept separate from `New test from latest draft`. That one means 'reread the revised manuscript'; this
 * one means 'start over under the same conditions'. Merging them would let someone who restarted
 * because they disliked a response unknowingly test a different revision.
 */
export const resetPlaytestConversation = (
	state: PlaytestState,
	sessionId: string,
): PlaytestState => ({
	...state,
	/**
	 * The snapshot is carried over, but the identity is newly issued. That is the entire race defense.
	 */
	session: { id: sessionId, snapshot: state.session.snapshot },
	messages: [],
	sessionOrigin: "reset",
});

/**
 * Changes the playtest-only start scene. The draft itself is not touched.
 *
 * It issues a new session identity and clears the conversation. Swapping only the opening of an
 * ongoing conversation would leave the accumulated history inconsistent with the current system
 * prompt, and that conversation could not say what it was testing. The draft revision (`source`) is
 * kept as is: a scene change must not pull in other edits.
 */
export const selectPlaytestStartScene = (
	state: PlaytestState,
	startSceneId: string | null,
	sessionId: string,
): PlaytestState =>
	createPlaytestState({
		source: state.source,
		sessionId,
		startSceneId,
		preference: state.preference,
		origin: "scene-changed",
	});

/** Changes the generation overrides used only in this test. The conversation continues. */
export const setPlaytestPreference = (
	state: PlaytestState,
	preference: GenerationPreference,
): PlaytestState => ({ ...state, preference });

export const appendPlaytestUserMessage = (
	state: PlaytestState,
	content: string,
	stamp: PlaytestStamp,
): PlaytestState => ({
	...state,
	messages: [
		...state.messages,
		{
			id: stamp.id,
			role: "user",
			/**
			 * The speaker name is empty. The v2 authoring tool does not create a counterpart record
			 * (`play.persona` is always `null`), so the prompt assembler supplies a default name. Inventing
			 * one here would put a name in the prompt that differs from the real conversation.
			 */
			speaker: "",
			content,
			createdAt: stamp.now,
		},
	],
});

/**
 * Appends a confirmed assistant response. The save decision was already made by a pure function
 * (`resolveGenerationOutcome` in @rowcat/chat) and is not re-decided here. As in the real
 * conversation, the content of a cut-off response is kept, and only a display marker records the
 * cut.
 */
export const appendPlaytestAssistantMessage = (
	state: PlaytestState,
	message: GeneratedAssistantMessage,
	stamp: PlaytestStamp,
): PlaytestState => ({
	...state,
	messages: [
		...state.messages,
		{
			id: stamp.id,
			role: "assistant",
			speaker: message.speaker ?? "",
			content: message.content,
			createdAt: stamp.now,
			...(message.model !== undefined ? { model: message.model } : {}),
			...(message.incomplete ? { incomplete: true } : {}),
		},
	],
});
