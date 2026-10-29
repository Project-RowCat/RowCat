import type { AuthoringStore, PlaytestSnapshot } from "@rowcat/authoring";
import {
	CHAT_HISTORY_LIMIT,
	type ConversationDebugState,
	type ConversationDebugStore,
	createConversationDebugStore,
	type GeneratedAssistantMessage,
	type GenerationPreference,
} from "@rowcat/chat";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import type { ConversationSession } from "#/features/conversation/session.ts";
import {
	type ConversationGenerationState,
	useConversationGeneration,
} from "#/features/conversation/use-conversation-generation.ts";
import { useAuthoringScope } from "#/lib/local-authoring/scope.ts";
import {
	appendPlaytestAssistantMessage,
	appendPlaytestUserMessage,
	createPlaytestState,
	type PlaytestMessage,
	type PlaytestState,
	resetPlaytestConversation,
	selectPlaytestStartScene,
	setPlaytestPreference,
} from "./playtest-session.ts";

/**
 * The React-owned temporary conversation of the playtest screen.
 *
 * It has no storage. This hook touches the local database once, when it reads the draft
 * (`loadPublicationSource`). The conversation is written nowhere, so it disappears when the screen
 * is left.
 *
 * Generation goes through the same hook as the conversation screen (`useConversationGeneration`).
 * This file supplies only the answers to the six questions that hook asks the conversation. Prompt
 * assembly, safety guards, target resolution, sending, and stream-end rules are not in this file.
 *
 * No AbortController: a request whose body has fully arrived passes the abort signal and completes
 * normally, and its final save arrives as a success. Two axes stop late responses:
 *
 * - History verdict: rewriteHistory raises it synchronously. This is what actually blocks late
 *   responses.
 * - Session identity: reset and reload create a new object. This is a second net, but it reaches
 *   the generation hook only after React re-renders.
 *
 * The history verdict comes first for timing reasons. The final block of an aborted stream runs in
 * an earlier microtask than React's re-render, and that window is exactly where a late response
 * attaches. So every operation that discards the conversation goes through
 * `generation.rewriteHistory` (see `discardConversation`): it raises the verdict first, aborts, and
 * only then commits (`features/conversation/generation-owner.ts`).
 */

export interface PlaytestController {
	/** The playtest that is running. Its snapshot does not change for the life of the session. */
	snapshot: PlaytestSnapshot;
	messages: PlaytestMessage[];
	startSceneId: string | null;
	preference: GenerationPreference;
	generation: ConversationGenerationState;
	/** Clears only the conversation. The snapshot, start scene, and overrides are kept. */
	resetConversation: () => void;
	/**
	 * Re-reads the draft to open a new playtest. On failure, the current playtest is left as is.
	 *
	 * The value is only success or failure. The screen needs to say why it failed, but that failure
	 * ('draft disappeared' or 'account changed') is not a reason to discard the current conversation.
	 */
	reloadLatestDraft: () => Promise<boolean>;
	/**
	 * Changes the playtest-only start scene, and a new conversation starts. The draft is not changed.
	 */
	selectStartScene: (startSceneId: string | null) => void;
	setPreference: (preference: GenerationPreference) => void;
	/**
	 * The observation log of this session: the values the debugger draws.
	 *
	 * When the session changes (reset, scene change, latest draft), the log is created anew. An
	 * in-flight generation's signal at that moment goes to the old log and never reaches the screen.
	 * This is another net on the same axis the ownership check uses to block saves.
	 */
	debug: ConversationDebugState;
}

/** Identity and time are created outside. The pure functions take them as arguments. */
const stamp = () => ({
	id: crypto.randomUUID(),
	now: new Date().toISOString(),
});

export function usePlaytest(initial: PlaytestState): PlaytestController {
	const { ensureStore, ownsStore } = useAuthoringScope();

	/**
	 * The source of truth is the ref; the state is a copy of it.
	 *
	 * The arrangement looks inverted, but it has one reason: a turn's sequence is tighter than React's
	 * render timing. The generation hook re-reads the history right after appending the user's
	 * utterance (use-conversation-generation.ts, steps 1 and 2). Between those there is only one
	 * microtask, while React's re-render runs in a later task. If only state were kept and the ref
	 * synced in an effect, that read would not see the utterance just appended. The model would
	 * respond without knowing what the user said, and there would be no way to find the cause, because
	 * the bubble is on screen.
	 *
	 * setState(updater) does not solve this either: the updater runs at the next render, so syncing
	 * the ref inside it leaves the same window. So the ref is set first and the state receives the
	 * already computed value. Every change goes through the single `update` below, so the two cannot
	 * diverge.
	 */
	const stateRef = useRef<PlaytestState>(initial);
	const [state, setState] = useState<PlaytestState>(initial);

	const update = useCallback(
		(next: (current: PlaytestState) => PlaytestState): void => {
			const updated = next(stateRef.current);
			stateRef.current = updated;
			setState(updated);
		},
		[],
	);

	/**
	 * This session's observation store: one per session.
	 *
	 * It is created during render and not cleaned up in an effect. The object holds no resources (only
	 * a listener set) and has nothing to stop, so StrictMode's double mount cannot leave a live
	 * instance stopped forever. Creating it in an effect would leave the first frame's generation
	 * without a store to record into.
	 *
	 * It is a ref rather than useMemo because useMemo is an optimization, not a guarantee: React may
	 * discard it, and then the log would be cleared for no reason.
	 */
	const debugRef = useRef<{
		session: PlaytestState["session"];
		store: ConversationDebugStore;
	} | null>(null);
	if (debugRef.current === null || debugRef.current.session !== state.session)
		debugRef.current = {
			session: state.session,
			store: createConversationDebugStore({
				now: () => Date.now(),
				newTurnId: () => crypto.randomUUID(),
			}),
		};
	const debug = debugRef.current.store;

	/**
	 * Writes the first line of this log: how the session was opened.
	 *
	 * It is written in an effect rather than during render because of the subscriber. The store
	 * notifies synchronously on every change, and if that notification arrived during render,
	 * useSyncExternalStore would hit a state update inside a render.
	 */
	useEffect(() => {
		/**
		 * The log has exactly one first line. Under StrictMode's double mount the effect runs twice, and
		 * because the store survives on the component instance's ref, the same event would be recorded as
		 * two lines. In a timeline that duplicate reads not as an error but as something that never
		 * happened.
		 */
		if (debug.getState().log.entries.length > 0) return;
		const snapshot = stateRef.current.session.snapshot;
		debug.emit({
			kind:
				stateRef.current.sessionOrigin === "reset"
					? "session-reset"
					: stateRef.current.sessionOrigin === "reloaded"
						? "session-reloaded"
						: stateRef.current.sessionOrigin === "scene-changed"
							? "scene-selected"
							: "session-started",
			data: {
				sessionId: stateRef.current.session.id,
				startSceneId: snapshot.startSceneId,
				loreCount: snapshot.seed.lore.length,
				startSceneCount: snapshot.startScenes.length,
			},
		});
	}, [debug]);

	const debugState = useSyncExternalStore(debug.subscribe, debug.getState);

	/**
	 * Adapter that connects this conversation to the generation runtime.
	 *
	 * `token` is the session object, the second net for the ownership check. The first net is the
	 * history verdict, which is synchronous (see the header above). If reset or reload creates a new
	 * session, this axis also blocks late responses from then on.
	 *
	 * The dependency is the one session object from render, on purpose. If the adapter were rebuilt on
	 * every message, its identity would change each turn, and the shared hook's abort effect would cut
	 * off an in-flight generation at the first response. So messages live outside the session
	 * (`playtest-session.ts`). The inner operations read `stateRef`, not render values, so reads stay
	 * current even if this memo is stale.
	 */
	const session = useMemo<ConversationSession>(() => {
		const token = state.session;
		return {
			token,
			runtime: {
				seed: token.snapshot.seed,
				/**
				 * The grade the draft declares. The effective grade is that combined with the viewer's
				 * eligibility, decided by the same function the real conversation uses (`resolveAllAges`). A
				 * test must not open a place where the adult gate loosens.
				 */
				adult: token.snapshot.adult,
			},
			/**
			 * The playtest-only override. The device-level (global) preference is read separately by the
			 * shared hook, which builds that layer.
			 */
			loadPreference: async () => stateRef.current.preference,
			/**
			 * History is cut at the same limit as a real conversation. A different value here would give
			 * long playtests and long conversations different context.
			 */
			loadHistory: async () =>
				stateRef.current.messages.slice(-CHAT_HISTORY_LIMIT),
			/**
			 * Playtests have no memory. An empty array means the assembler builds no memory block at all, so
			 * the prompt is byte-for-byte the same as a real room that has no memories.
			 */
			loadMemories: async () => [],
			/**
			 * Playtest sessions have no characters, for the same reason memory is an empty array. A session
			 * that is about to disappear would create child records that belong to no room.
			 */
			loadCharacters: async () => [],
			/**
			 * No summary either, for the same reason, and therefore no `maintain`.
			 *
			 * A playtest session has no record that could hold a summary. A room-level summary would create
			 * a record belonging to no room, and automatic maintenance would bill a paid call whose result
			 * is stored nowhere, so the cost would accumulate across repeated trials. The absence is
			 * expressed in this adapter without a conditional (`maintain` is optional).
			 */
			loadSummary: async () => "",
			appendUserMessage: async (content: string) => {
				update((current) =>
					appendPlaytestUserMessage(current, content, stamp()),
				);
			},
			/**
			 * Returns the identity. Only this conversation knows the correspondence. If the screen guessed
			 * later (assuming the last line is the last turn's), a single late-finishing generation would
			 * break that guess, and the inspector would report another turn's prompt as the basis for this
			 * response.
			 */
			appendAssistantMessage: async (message: GeneratedAssistantMessage) => {
				const mark = stamp();
				update((current) =>
					appendPlaytestAssistantMessage(current, message, mark),
				);
				return mark.id;
			},
		};
	}, [state.session, update]);

	const generation = useConversationGeneration(session, { debug });

	/**
	 * Every operation that discards the conversation goes through `rewriteHistory`.
	 *
	 * Replacing the session object alone is not enough, which is the point of this wiring. Its
	 * identity reaches the generation hook only after React re-renders, but the final block of a
	 * just-aborted stream runs in an earlier microtask. In that window a late response can attach to
	 * the conversation that was just cleared.
	 *
	 * `rewriteHistory` exists for this gate: it raises the history verdict synchronously first,
	 * aborts, then commits (`use-conversation-generation.ts`). Edit, regenerate, and delete-from-here
	 * on the conversation screen pass through the same gate. Reset, scene change, and latest-draft
	 * reload rewrite the whole conversation, so the same gate fits. No generation starts afterward,
	 * since the user asked for cleanup.
	 */
	const discardConversation = useCallback(
		(next: (current: PlaytestState) => PlaytestState): Promise<void> =>
			generation.rewriteHistory(async () => {
				update(next);
			}),
		[generation.rewriteHistory, update],
	);

	const resetConversation = useCallback(() => {
		void discardConversation((current) =>
			resetPlaytestConversation(current, crypto.randomUUID()),
		);
	}, [discardConversation]);

	const selectStartScene = useCallback(
		(startSceneId: string | null) => {
			void discardConversation((current) =>
				selectPlaytestStartScene(current, startSceneId, crypto.randomUUID()),
			);
		},
		[discardConversation],
	);

	const setPreference = useCallback(
		(preference: GenerationPreference) => {
			update((current) => setPlaytestPreference(current, preference));
		},
		[update],
	);

	const reloadLatestDraft = useCallback(async (): Promise<boolean> => {
		const store: AuthoringStore | null = await ensureStore();
		if (!store) return false;
		const source = await store.loadPublicationSource(
			stateRef.current.session.snapshot.draftId,
		);
		if (!source) return false;
		/**
		 * If the account changed during the read, do nothing. The test on screen belongs to the previous
		 * member and will be removed anyway (the route gate decides). Swapping in someone else's draft
		 * here would make that screen draw another person's manuscript for one frame.
		 */
		if (!ownsStore(store)) return false;

		await discardConversation((current) =>
			createPlaytestState({
				source,
				sessionId: crypto.randomUUID(),
				/**
				 * The playtest-only selection is carried over. Rereading the draft updates the manuscript; it
				 * does not revert the test conditions the user chose. If the scene was deleted in the meantime,
				 * the factory folds to the default opening.
				 */
				startSceneId: current.startSceneId,
				preference: current.preference,
				origin: "reloaded",
			}),
		);
		return true;
	}, [ensureStore, ownsStore, discardConversation]);

	return {
		snapshot: state.session.snapshot,
		messages: state.messages,
		startSceneId: state.startSceneId,
		preference: state.preference,
		generation,
		resetConversation,
		reloadLatestDraft,
		selectStartScene,
		setPreference,
		debug: debugState,
	};
}
