import type {
	PlaytestSnapshot,
	StoryPublicationSource,
} from "@rowcat/authoring";
import { buildPlaytestSnapshot } from "@rowcat/authoring";
import type {
	ConversationDisplayMessage,
	GeneratedAssistantMessage,
	GenerationPreference,
} from "@rowcat/chat";
import { EMPTY_GENERATION_PREFERENCE } from "@rowcat/chat";

/**
 * Playtest state. **It lives only in memory.**
 *
 * The absence of a store in this file is the boundary of the whole slice. Nothing here goes into
 * SQLite, SecureStore, AsyncStorage, the query cache or the sync codec registry. It vanishes when
 * the screen is left, and that is intended: a conversation the creator ran while polishing a draft
 * is **a working trace**, not product data. Storing it would force `/chats`, the drawer's recent
 * rooms, sync and account-deletion cleanup to all know it exists.
 *
 * So this design does not create a room with `ChatStore.createRoom()` and hide it from lists. Such
 * a record carries dirty, revision and tombstone markers and **rides along on the next push**.
 * Hiding is the screen's job, and sync does not look at the screen.
 *
 * Every function here is pure. Creating **a new object instead of mutating the session** is also a
 * rule: identity is the axis of the ownership check (`canPersistGeneration` in `@rowcat/chat`), so
 * the moment reset or reload creates a new object, an in-flight generation loses its conversation.
 *
 * This is the **same table** as `apps/web/src/features/playtest/playtest-session.ts`. It was not
 * lifted into a shared package because its consumer is the screen state model. The pure rules that
 * carry the values (snapshot assembly) already live in `@rowcat/authoring`; what remains here is
 * **this app's screen state** layered on that snapshot.
 */

/**
 * One line of the message being played.
 *
 * Not a `ChatMessage`. It has no sync metadata (`dirty`, `rev`, `serverVersion`), no tombstone and
 * no room identity. That absence expresses the fact that the value is never persisted, and since
 * nothing is fabricated, it cannot leak into the store by mistake. It inherits the five axes the
 * list reads (`ConversationDisplayMessage`), so it draws as **the same line** as the conversation
 * screen.
 */
export interface PlaytestMessage extends ConversationDisplayMessage {
	/** Not for display (no timestamp is drawn). It records that ordering is deterministic. */
	createdAt: string;
	/** The model that actually responded. Carried only when the provider reported it. */
	model?: string;
}

/**
 * One test: **only the fixed part**, namely identity and snapshot.
 *
 * Keeping the conversation out of here is the point of this type. The **reference identity** of
 * this object is the ownership axis (`ConversationSession.token`). If it were rebuilt each time a
 * message is appended, an in-flight generation would lose its conversation every turn and cut
 * itself off the moment the first response arrives.
 *
 * A new object appears in only three cases, and all three are **the user deciding to discard the
 * conversation now**: reset, start-scene change, and latest-draft reload.
 *
 * `id` never appears on screen. It exists only so identity can also be compared by value.
 */
export interface PlaytestSession {
	id: string;
	snapshot: PlaytestSnapshot;
}

/**
 * The whole test that is open right now.
 *
 * Holding `source` is the most important decision in this type. Changing the start scene means
 * rebuilding the snapshot, and at that point **the store must not be re-read**: edits brought in by
 * another device's sync during that gap would slip in silently, and the user would see changes they
 * never made take effect. Exactly one operation re-reads the draft, and it has its own name (`New test
 * from latest draft`).
 */
/**
 * How this test was opened: the value the first line of the observation record states.
 *
 * It lives in state rather than on the session object because that object's **reference identity is
 * the ownership axis** (see the `PlaytestSession` header). Adding a field there is harmless today,
 * but it would weaken the promise that the type holds only the fixed part.
 *
 * This value belongs to **the new session**. If a reset wrote "cleared" onto the old session, that
 * record would go to a store nobody reads (the store is reopened along with the session), and the
 * new record on screen could not say how it started.
 */
export type PlaytestSessionOrigin =
	/** Opened this draft for the first time. */
	| "opened"
	/** Cleared only the conversation, under the same conditions. */
	| "reset"
	/** Re-read the latest draft; **the manuscript may have changed.** */
	| "reloaded"
	/** Changed the start scene. */
	| "scene-changed";

export interface PlaytestState {
	/** The draft version this test was opened from. Not re-read here (see above). */
	source: StoryPublicationSource;
	/** The fixed part. If this object changes, an in-flight generation cannot write anything. */
	session: PlaytestSession;
	/** The conversation built on top. Appending messages leaves `session` unchanged (see above). */
	messages: PlaytestMessage[];
	/** Playtest-only start scene selection. `null` means the draft's default opening. */
	startSceneId: string | null;
	/**
	 * Generation override used only in this test. **It is stored neither in the draft nor in device
	 * preferences.**
	 *
	 * The draft does not carry `model` or `responseLength` because they are not authoring attributes:
	 * the model is a device and account axis, and a work plays with any model. It is not written to
	 * the global preference because one test must not change the person's default for every
	 * conversation. So it lives here, only for as long as the screen does.
	 */
	preference: GenerationPreference;
	/** How this session was opened. Not shown on screen; the first line of the observation record reads it. */
	sessionOrigin: PlaytestSessionOrigin;
}

/** Values received from outside when building a record: identity and time. Kept this way to stay pure. */
export interface PlaytestStamp {
	id: string;
	/** ISO 8601. */
	now: string;
}

/**
 * Opens a test on one draft version.
 *
 * The snapshot is built **once** here and never changes afterward. If the system prompt changed
 * mid-conversation, nobody could explain what is being tested, and real conversations do not run
 * that way either (a room keeps the seed it was acquired with).
 */
export function createPlaytestState(input: {
	source: StoryPublicationSource;
	sessionId: string;
	/** Playtest-only selection to carry over. Passed on a **reload**, not on a new test. */
	startSceneId?: string | null;
	preference?: GenerationPreference;
	/** Defaults to "opened"; a reloading caller passes its own name. */
	origin?: PlaytestSessionOrigin;
}): PlaytestState {
	const requested = input.startSceneId ?? null;
	const snapshot = buildPlaytestSnapshot(input.source, {
		startSceneId: requested,
	});
	/**
	 * If the chosen scene is not in this version (it was removed between reloads), the snapshot has
	 * already folded to the default opening. The selection is cleared to match. Keeping it would draw
	 * the control as if the missing scene were chosen, and the screen would say something different
	 * from the opening actually loaded.
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
 * Clears only the conversation. **The snapshot, start scene and generation override stay.**
 *
 * This is kept apart from `New test with the latest draft`. This one means "start again from the top under the same
 * conditions"; that one means "re-read the revised manuscript". Merging them would make someone who
 * restarted because they disliked a response **unknowingly test a different version**.
 */
export const resetPlaytestConversation = (
	state: PlaytestState,
	sessionId: string,
): PlaytestState => ({
	...state,
	/** Carries the snapshot over, but **issues a new identity**; that is the whole of the race defence. */
	session: { id: sessionId, snapshot: state.session.snapshot },
	messages: [],
	sessionOrigin: "reset",
});

/**
 * Changes the playtest-only start scene. **The draft is not touched.**
 *
 * Issues a new session identity and clears the conversation. Swapping only the opening of a
 * conversation in progress would leave the accumulated history out of step with the current system
 * prompt, and that conversation could no longer say what it tested. **The draft version (`source`)
 * is used as-is**: changing a scene must not pull in other edits.
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

/** Changes the generation override used only in this test. The conversation carries on. */
export const setPlaytestPreference = (
	state: PlaytestState,
	preference: GenerationPreference,
): PlaytestState => ({ ...state, preference });

/** Appends one user utterance. */
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
			 * The speaker name is empty. v2 authoring tools create no counterpart record (`play.persona` is
			 * always `null`), so the assembler attaches the default name. Inventing one here would put a
			 * name in the prompt that differs from a real conversation.
			 */
			speaker: "",
			content,
			createdAt: stamp.now,
		},
	],
});

/**
 * Appends a committed assistant response.
 *
 * The save decision has already been made by a pure function (`resolveGenerationOutcome` in
 * `@rowcat/chat`), so it is not re-judged here. As in a real conversation, a cut-off response keeps
 * its content and leaves only a marker.
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
