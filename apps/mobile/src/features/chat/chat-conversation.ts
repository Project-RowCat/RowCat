import {
	type AssistantContinuation,
	CHAT_HISTORY_LIMIT,
	type ChatRoom,
	type ChatStore,
	type ConversationSession,
	effectiveChatPersona,
	type GeneratedAssistantMessage,
	type GenerationPreferenceStore,
	protectedStoryIdOf,
} from "@rowcat/chat";

/**
 * Adapter binding one local room to the conversation runtime. Generation ordering, failure handling
 * and ownership decisions are not here (`use-chat-generation.ts` and `@rowcat/chat`'s pure
 * functions); only the persistence answers remain:
 *
 * ```text
 * save user turn   store.appendMessage(...)      room activity time rises in the same transaction
 * history          store.listRecentMessages      the store's order is the next turn's history
 * memory           store.listMemories            per room
 * this layer's override  preferences.getRoom(room.id)  device-local, not synced
 * execution identity     store instance + effective persona  differs across `Alice → guest → Alice` and persona swaps
 * ```
 *
 * Web's `features/chat/generation/use-generation.ts` fills the same table; both apps filling the
 * same port keeps "what is saved when the stream breaks" from diverging per platform.
 *
 * The room override is read from the device preference store. When that store is not open yet it
 * answers `null`, so precedence falls to the upper layers (global, then product default): one
 * unreadable preference must not block the conversation. No fake preference object is invented
 * here; `{ responseLength: "standard", target: <product default> }` would claim the room chose
 * those values and pin every room to old values when the product default changes.
 *
 * Global preferences do not come through this port, which answers only what this layer decided
 * (`ConversationSession.loadPreference`). The generation lifecycle merges them
 * (`generation-turn.ts`), as web's `use-conversation-generation.ts` does.
 */
/**
 * The effective-persona key that goes into the execution identity; same rule as web's `personaKey`
 * in `use-chat-generation.ts`. When this app's token was the store alone, changing the persona
 * mid-stream saved the response into the new speaker's conversation while the system prompt carried
 * the old persona.
 *
 * It is folded to a string so memo dependencies compare by value: a snapshot object would be a new
 * reference on every room re-read and cut the in-flight generation. Name and description are
 * counted together because the description goes into the system prompt verbatim.
 */
export function chatPersonaKey(room: ChatRoom | null): string {
	const persona = room ? effectiveChatPersona(room) : null;
	return persona ? `${persona.name}\u0000${persona.description}` : "";
}

export function createChatConversation(input: {
	room: ChatRoom;
	store: ChatStore;
	/**
	 * Execution identity: the store paired with the effective persona (`chatPersonaKey`), frozen into
	 * an object. It is not built here for reference identity: a literal would be a new object on every
	 * room update and cut the in-flight generation. The screen's memo keeps it stable
	 * (`chat-screen.tsx`).
	 */
	token: object;
	/** Where this room's generation override is read; `null` before the scope opens, when the conversation follows the upper layers. */
	preferences: GenerationPreferenceStore | null;
	/**
	 * Wakes auto-maintenance after a final response is saved (`useMemoryMaintenance`). The adapter
	 * does not hold the runner because this function is pure assembly; maintenance needs the viewer,
	 * query client and preference store, and pulling them in would force every caller (tests included)
	 * to wire all three.
	 */
	maintain?: (() => void) | undefined;
}): ConversationSession {
	const { room, store, preferences } = input;
	const protectedStoryId = protectedStoryIdOf(room);
	return {
		// The store instance is in the token because a member id is not enough: after sign-out and return
		// the id matches but the connection was closed and reopened, so writes to the old instance hit a
		// closed connection. The persona is in it per `chatPersonaKey`.
		token: input.token,
		runtime: room,
		// A prompt-protected room is assembled by the server; the manuscript is not on this device
		// (`protectedStoryIdOf`, shared by both apps).
		...(protectedStoryId ? { protectedStoryId } : {}),
		// A direct read, not a subscription, frozen into the request when generation starts. Going
		// through render state would make "which settings this request used" depend on render timing.
		loadPreference: async () => (await preferences?.getRoom(room.id)) ?? null,
		loadHistory: () =>
			store.listRecentMessages(room.id, { limit: CHAT_HISTORY_LIMIT }),
		loadMemories: () => store.listMemories(room.id),
		// Characters added in this conversation are frozen at start, like memory.
		loadCharacters: () => store.listCharacters(room.id),
		// Summary is frozen at start, like memory: background maintenance may update it mid-stream, and
		// picking up the new version would make the request's context depend on timing.
		loadSummary: async () => (await store.getSummary(room.id))?.summary ?? "",
		// The routing-affinity key is ensured, not read (same wiring as web). Rooms created before this
		// axis have none, and the fix is to issue and store one; unstored, every turn would send a
		// different key, which is worse than none.
		loadRoutingSessionId: () => store.ensureRoomRoutingSession(room.id),
		// Narration is re-read from the store rather than taken from `room.narration`: `room` is a
		// render-time snapshot that may not yet include a change just made in the settings dialog, so
		// only the first turn after switching to autoplay would go out with the old setting. Nobody can
		// reproduce that, so it is read once at start and frozen.
		loadNarration: async () =>
			(await store.getRoom(room.id))?.narration ?? null,
		...(input.maintain ? { maintain: input.maintain } : {}),
		appendUserMessage: async (content: string) => {
			await store.appendMessage({
				roomId: room.id,
				role: "user",
				content,
				// The speaker name belongs to the conversation, not the lifecycle's arguments. Precedence comes
				// from the shared `effectiveChatPersona`, so both apps name the same utterance identically.
				speaker: effectiveChatPersona(room)?.name ?? "",
			});
		},
		// Returns the saved row's id. The store already minted it, and this is the only place that knows
		// the mapping, so the screen need not guess later (see
		// `ConversationSession.appendAssistantMessage`).
		appendAssistantMessage: async (message: GeneratedAssistantMessage) => {
			const saved = await store.appendMessage({ roomId: room.id, ...message });
			return saved.id;
		},
		// Continuation of a cut response; the store keeps the merge rule via the shared pure
		// `extendAssistantRecord` (same as web Dexie). The screen shows `Continue generating` only for sessions with
		// this capability.
		extendAssistantMessage: async (
			messageId: string,
			continuation: AssistantContinuation,
		) => {
			await store.extendMessage(messageId, continuation);
		},
	};
}
