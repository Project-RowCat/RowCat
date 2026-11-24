import {
	type AssistantContinuation,
	activeUserTools,
	type ChatRoom,
	type ChatStore,
	type ConversationMemoryRuntime,
	conversationMemoryHooks,
	createMaintainer,
	effectiveChatPersona,
	type GeneratedAssistantMessage,
	type GenerationPreference,
	type GenerationPreferenceStore,
	loadChatHistoryWindow,
	protectedStoryIdOf,
	roomToolOverrides,
} from "@rowcat/chat";
import { useEffect, useMemo } from "react";
import type { ConversationSession } from "#/features/conversation/session.ts";
import {
	type ConversationGenerationState,
	useConversationGeneration,
} from "#/features/conversation/use-conversation-generation.ts";
import { useMemoryRuntime } from "#/lib/afterstate/use-memory-runtime.ts";
import { useChatScope } from "#/lib/local-chat/scope.ts";
import { useGenerationScope } from "#/lib/local-generation/scope.ts";

/**
 * An adapter that plugs one local room into the conversation runtime. Ordering, failure handling
 * and ownership checks are not here: they live in
 * features/conversation/use-conversation-generation.ts, and the scenario tests pass through that
 * same hook. Keeping this boundary is the file's reason to exist. If two conversations had separate
 * lifecycles, rules such as 'what is stored when a stream drops' or 'when a late response is
 * discarded' would silently diverge on one side only.
 *
 * What remains here is the answer on persistence:
 * - User message save: store.appendMessage(...), which also advances the room's activity time in
 *   the same transaction.
 * - History: loadChatHistoryWindow over the store's reads; the store's order is the next turn's history.
 * - Memory: store.listMemories, the room-level memory the person wrote; long-term memory is the
 *   afterstate index on this device (conversationMemoryHooks), the only engine there is.
 * - Preference override for this layer: preferences.getRoom(room). It is a device-local
 *   preference, not a room record.
 * - Execution identity: store instance plus role. `Alice → guest → Alice` and persona swaps
 *   differ on this identity.
 */

/**
 * The token pairs the store with the effective role, not just the store. Account switching can
 * reopen the connection under the same account id, so writes aimed at the old instance hit a closed
 * connection (generation-owner.ts). Changing role mid-stream means an in-flight generation carries
 * a persona setup that no longer matches the speaker, and it must not persist.
 *
 * If either part diverges, that generation writes nothing (canPersistGeneration) and the shared
 * hook cuts the request. Judge by state, not by the abort signal: a request whose body has fully
 * arrived can still complete as success after an abort.
 *
 * Title and activity-time changes do not diverge, since the token is derived from store and role,
 * not the room record.
 */
export function createChatConversation(input: {
	room: ChatRoom;
	store: ChatStore;
	/**
	 * The execution identity of this conversation: store and effective role, frozen together. It is
	 * not built inline because reference identity matters. A literal here would create a new object
	 * each render and cut an in-progress generation each time; stabilising the value is the hook's
	 * job.
	 */
	token: object;
	/**
	 * May be absent: the scope has not opened yet or failed to open. Then only the global preference
	 * layer applies.
	 */
	preferences: GenerationPreferenceStore | null;
	/**
	 * The afterstate engine on this device, if this platform has one. Absent (a plain browser, or the
	 * engine failed to open): chat still works on the recent window and the memories the person
	 * wrote, and the session reports long-term memory as `unavailable` — nothing else stands in.
	 */
	memory?: ConversationMemoryRuntime | null;
}): ConversationSession {
	const { room, store, preferences } = input;
	const protectedStoryId = protectedStoryIdOf(room);
	const memoryHooks = conversationMemoryHooks(input.memory, store, room.id, {
		protectedRoom: !!protectedStoryId,
	});
	return {
		token: input.token,
		runtime: room,
		/**
		 * The protected prompt's room is assembled by the server; the source text is not on this device.
		 * protectedStoryIdOf is shared by both apps.
		 */
		...(protectedStoryId ? { protectedStoryId } : {}),
		loadPreference: async (): Promise<GenerationPreference | null> =>
			(await preferences?.getRoom(room.id)) ?? null,
		/**
		 * The window steps on the room's message count (`chatHistoryWindow`), never on any summary: one
		 * count and one bounded read of the newest messages, whatever the room's length. How many to read
		 * is the shared loader's rule (`loadChatHistoryWindow`), the same one mobile uses.
		 */
		loadHistory: () =>
			loadChatHistoryWindow({
				recent: (limit) => store.listRecentMessages(room.id, { limit }),
				count: () => store.countMessages(room.id),
			}),
		loadMemories: () => store.listMemories(room.id),
		/**
		 * Characters introduced to this conversation are also read once, at start, like memory.
		 * Characters added while a response streams do not affect this request; it finishes with the
		 * roster it started with.
		 */
		loadCharacters: () => store.listCharacters(room.id),
		loadScenes: () => store.listScenes(room.id),
		/** Attached files, read once per turn like characters — and on every turn (`attachment.ts`). */
		loadAttachments: () => store.listAttachments(room.id),
		/**
		 * The routing-friendly key is obtained, not merely read. room.routingSessionId is not passed
		 * directly: rooms created before this field existed do not have it, so the needed step is to
		 * issue one and save it. Without saving, a different key would go out each turn, which is worse
		 * than none. Issuance is the store's job (ensureRoomRoutingSession).
		 */
		loadRoutingSessionId: () => store.ensureRoomRoutingSession(room.id),
		/**
		 * The narration style is re-read from the store rather than taken from room.narration. The room
		 * passed in is a render-time snapshot, and a value just changed in the settings dialog may not
		 * have reached it yet. Then only the first turn sent right after switching to autoplay goes out
		 * with the old setting. Nobody could reproduce that, so the value is read once at start and
		 * frozen.
		 */
		loadNarration: async () =>
			(await store.getRoom(room.id))?.narration ?? null,
		/**
		 * The user's tools on in this room, re-read for loadNarration's reason: both halves (the room's
		 * overrides and the library) can change in the settings screens right before a send. A room
		 * deleted in the meantime answers none rather than every default-on tool.
		 */
		loadUserTools: async () => {
			const [current, tools] = await Promise.all([
				store.getRoom(room.id),
				store.listUserTools(),
			]);
			return current ? activeUserTools(current, tools) : [];
		},
		/**
		 * The room's tool switches, re-read for the same reason: the creator's `http` tools run only
		 * where the reader switched them on (`creatorToolActiveIn`). A room deleted meanwhile answers
		 * none, which switches every one of them off.
		 */
		loadToolOverrides: async () =>
			roomToolOverrides((await store.getRoom(room.id)) ?? {}),
		...memoryHooks,
		appendUserMessage: async (content: string) => {
			await store.appendMessage({
				roomId: room.id,
				role: "user",
				content,
				/**
				 * The speaker name belongs to the conversation; the lifecycle does not take it as an argument.
				 * The room's override wins; otherwise the story's suggested counterpart. The priority is not
				 * restated here: a shared predicate (effectiveChatPersona) decides it, so this app and mobile
				 * name the same utterance identically.
				 *
				 * The name frozen here does not change afterwards. Changing role later does not rewrite saved
				 * speakers, because that is what happened in the conversation; editing it back would be an edit
				 * the user never made.
				 */
				speaker: effectiveChatPersona(room)?.name ?? "",
			});
		},
		/**
		 * Returns the identity of the saved line. The store already created the value, so nothing is
		 * invented here. This is the only place that knows the mapping, so the screen does not need to
		 * guess later (ConversationSession.appendAssistantMessage).
		 */
		appendAssistantMessage: async (message: GeneratedAssistantMessage) => {
			const saved = await store.appendMessage({ roomId: room.id, ...message });
			return saved.id;
		},
		/**
		 * Continuation of a truncated response. The merge rules are enforced by the store as a shared
		 * pure function (extendAssistantRecord). Only sessions with this capability make the screen show
		 * `Continue generating`; the scenario test does not supply it, so there the row action is copy only.
		 */
		extendAssistantMessage: async (
			messageId: string,
			continuation: AssistantContinuation,
		) => {
			await store.extendMessage(messageId, continuation);
		},
	};
}

/**
 * Generation state the conversation screen uses. If the room or store does not exist yet, no
 * session is created. The shared hook starts nothing when the session is null (this takes the place
 * of the ready check in canStartGeneration), so the screen only needs to disable the input.
 */
export function useChatGeneration(
	room: ChatRoom | null,
): ConversationGenerationState {
	const { store, viewerId } = useChatScope();
	// The local afterstate engine: native preload in Electron, WASM Worker in a browser.
	const memory = useMemoryRuntime(viewerId, store);
	const { store: preferences } = useGenerationScope();
	const roomId = room?.id ?? null;
	useEffect(() => {
		// Browser indexes disappear on reload. Rebuild from the authoritative local records as
		// soon as a room opens, before its first reply; a per-room single flight coalesces this
		// with the same maintainer used after saves and by the memory screen.
		if (store && roomId) createMaintainer(memory, store, roomId)?.();
	}, [store, roomId, memory]);

	/**
	 * The execution identity: store and effective role together, a new object only when those two
	 * diverge. Folding the role into a string for the dependency is the point. Putting the snapshot
	 * object in would give a new reference each time liveQuery re-reads the room (every appended
	 * message), cutting the in-flight generation. Same value, same identity.
	 */
	const personaKey = useMemo(() => {
		const persona = room ? effectiveChatPersona(room) : null;
		/*
		 * Counts name and description together. Comparing only the name would miss a role whose
		 * description was edited under the same name, and the description goes verbatim into the system
		 * prompt.
		 */
		return persona ? `${persona.name}\u0000${persona.description}` : "";
	}, [room]);

	const token = useMemo(() => ({ store, personaKey }), [store, personaKey]);

	/**
	 * The session object is not rebuilt on each render. Its identity is not used for ownership (that
	 * is `token` above), but rebuilding it each render would re-run the shared hook's effects on every
	 * render.
	 */
	const session = useMemo(
		() =>
			room && store
				? createChatConversation({
						room,
						store,
						preferences,
						token,
						memory,
					})
				: null,
		[room, store, preferences, token, memory],
	);

	return useConversationGeneration(session);
}
