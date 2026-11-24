import {
	type AssistantContinuation,
	activeUserTools,
	type ChatRoom,
	type ChatStore,
	type ConversationMemoryRuntime,
	type ConversationSession,
	conversationMemoryHooks,
	effectiveChatPersona,
	type GeneratedAssistantMessage,
	type GenerationPreferenceStore,
	loadChatHistoryWindow,
	protectedStoryIdOf,
	roomToolOverrides,
} from "@rowcat/chat";

/**
 * Adapter binding one local room to the conversation runtime. Generation ordering, failure handling
 * and ownership decisions are not here (`use-chat-generation.ts` and `@rowcat/chat`'s pure
 * functions); only the persistence answers remain:
 *
 * ```text
 * save user turn   store.appendMessage(...)      room activity time rises in the same transaction
 * history          loadChatHistoryWindow         the store's order is the next turn's history
 * memory           store.listMemories            per room, written by the person
 * long-term memory conversationMemoryHooks       afterstate on this device, the only engine
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
	 * The afterstate engine on this device (`afterstate-memory` module), if loaded — the only
	 * long-term memory there is. Absent: chat works on the recent window and the memories the person
	 * wrote, and long-term memory reports `unavailable`. Same shared wiring as web.
	 */
	memory?: ConversationMemoryRuntime | null;
}): ConversationSession {
	const { room, store, preferences } = input;
	const protectedStoryId = protectedStoryIdOf(room);
	const memoryHooks = conversationMemoryHooks(input.memory, store, room.id, {
		protectedRoom: !!protectedStoryId,
	});
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
		// The window steps on the room's message count (`chatHistoryWindow`), never on a summary: one
		// count and one bounded read of the newest messages. The shared loader's rule
		// (`loadChatHistoryWindow`), the same one web uses.
		loadHistory: () =>
			loadChatHistoryWindow({
				recent: (limit) => store.listRecentMessages(room.id, { limit }),
				count: () => store.countMessages(room.id),
			}),
		loadMemories: () => store.listMemories(room.id),
		// Characters added in this conversation are frozen at start, like memory.
		loadCharacters: () => store.listCharacters(room.id),
		loadScenes: () => store.listScenes(room.id),
		// Attached files ride every turn (`attachment.ts`); attached on web or here, read the same way.
		loadAttachments: () => store.listAttachments(room.id),
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
		// The user's tools on in this room, re-read for narration's reason (same wiring as web): both
		// halves, the room's overrides and the library, can change in settings right before a send. A
		// room deleted meanwhile answers none rather than every default-on tool.
		loadUserTools: async () => {
			const [current, tools] = await Promise.all([
				store.getRoom(room.id),
				store.listUserTools(),
			]);
			return current ? activeUserTools(current, tools) : [];
		},
		// The room's tool switches, re-read for the same reason (same wiring as web): the creator's
		// `http` tools run only where the reader switched them on. A deleted room answers none.
		loadToolOverrides: async () =>
			roomToolOverrides((await store.getRoom(room.id)) ?? {}),
		...memoryHooks,
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
