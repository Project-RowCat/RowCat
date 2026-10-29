import type {
	ConversationSession,
	GeneratedAssistantMessage,
} from "@rowcat/chat";
import { CHAT_HISTORY_LIMIT } from "@rowcat/chat";
import {
	appendPlaytestAssistantMessage,
	appendPlaytestUserMessage,
	type PlaytestSession,
	type PlaytestStamp,
	type PlaytestState,
} from "./playtest-session.ts";

/**
 * Adapter that plugs a playtest into the conversation runtime.
 *
 * Generation ordering, failure handling and ownership checks are not here: they live in
 * `features/chat/generation/use-generation.ts`, and the pure functions in `@rowcat/chat` decide the
 * rules. What remains is the answer to persistence questions, and every answer for this
 * conversation is "none":
 *
 * ```text
 * save user utterance   append to memory state          does not pass through a store
 * history               the memory array, same cap      must be the same window as a real conversation
 * memories              empty array                     no record to hold them
 * summary               empty string                    likewise (so there is no `maintain`)
 * override here        playtest preference in memory   not written to device or room preferences
 * runtime identity     the playtest session object     reset and reload create a new object
 * ```
 *
 * `chat-conversation.ts` fills the same table. Where that file answers with storage, this one
 * answers with memory. Both fill the same port, so what gets left behind when a stream drops does
 * not differ by conversation kind.
 *
 * Why this is split from the hook: this app's tests do not render screens (`vitest.config.ts`). If
 * the adapter lived inside the hook, the rules below could only be checked by hand, and violations
 * would be silent. The most dangerous case is the history read right after appending a user
 * utterance (see `loadHistory`).
 */

export interface PlaytestConversationPorts {
	/** The runtime identity of this conversation. It does **not** change while the conversation continues. */
	session: PlaytestSession;
	/**
	 * Reads the current state **synchronously**.
	 *
	 * The reason for this port is that it reads the ref, not render state. The pure turn re-reads
	 * history right after appending the user's utterance, with only one microtask between. React
	 * re-renders in a later task, so reading render state would miss the just-appended utterance and
	 * the model would reply without knowing what the user said.
	 */
	read: () => PlaytestState;
	/** Changes the state. The caller updates the ref first and lets render state follow. */
	write: (next: (current: PlaytestState) => PlaytestState) => void;
	/** Identity and timestamp of a line. Passed in so this module stays pure. */
	stamp: () => PlaytestStamp;
}

export function createPlaytestConversation({
	session,
	read,
	write,
	stamp,
}: PlaytestConversationPorts): ConversationSession {
	return {
		/**
		 * **The session object is the token.** It is the second guard for ownership (the first is the
		 * history check, which is synchronous). Anything that creates a new object (reset, scene change,
		 * reload) makes an in-flight generation lose its conversation.
		 *
		 * Messages live outside this object for that reason. If they lived inside, the identity would
		 * change on every message, and a generation would cut itself off when the first response arrived.
		 */
		token: session,
		runtime: {
			seed: session.snapshot.seed,
			/**
			 * The rating the draft specifies. The effective rating is this combined with the viewer's
			 * entitlement, decided by the same function real conversations use (`resolveAllAges`), so the
			 * test does not create a place where the adult gate loosens.
			 */
			adult: session.snapshot.adult,
		},
		// Playtest-only override. The global device preference is read separately by the pure turn to
		// build its layer.
		loadPreference: async () => read().preference,
		/**
		 * History, cut to the same cap as a real conversation. A different value here would give long
		 * tests and long conversations different context, and this screen could then not reproduce
		 * playback after publishing.
		 */
		loadHistory: async () => read().messages.slice(-CHAT_HISTORY_LIMIT),
		/**
		 * No memories in a test. An empty array means the assembler builds no memory block at all, so the
		 * prompt is byte-identical to a real room without memories.
		 */
		loadMemories: async () => [],
		/**
		 * A playtest session has no characters, for the same reason it has no memories: a session that is
		 * discarded would otherwise create child records that belong to no room.
		 */
		loadCharacters: async () => [],
		/**
		 * No summary either, for the same reason, and therefore no `maintain`.
		 *
		 * A playtest session has no record to hold a summary. A per-room summary would create a record
		 * that belongs to no room, and running auto-maintenance would make a paid call whose result is
		 * stored nowhere, so every test run costs money. The absence is expressed in this object without
		 * a conditional (`maintain` is optional).
		 */
		loadSummary: async () => "",
		appendUserMessage: async (content: string) => {
			write((current) => appendPlaytestUserMessage(current, content, stamp()));
		},
		/**
		 * **Returns the identity.** Only this conversation knows the correspondence between a response
		 * and its turn. If the screen guessed later (assuming the last line belongs to the last turn), a
		 * late-finishing generation would break that guess, and the inspector would attribute the
		 * response to another turn's prompt.
		 */
		appendAssistantMessage: async (message: GeneratedAssistantMessage) => {
			const mark = stamp();
			write((current) =>
				appendPlaytestAssistantMessage(current, message, mark),
			);
			return mark.id;
		},
		/**
		 * `extendAssistantMessage` is **absent**. That is the structural expression of the fact that `Continue
		 * generating` does not appear on this screen. The operation appends text to a stored record
		 * (`extendAssistantRecord`), and this conversation has no such record. The pure turn reads the
		 * absence and does not start the continuation silently (`generation-turn.ts`).
		 */
	};
}
