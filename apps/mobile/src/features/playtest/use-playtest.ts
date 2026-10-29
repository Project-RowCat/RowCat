import type { AuthoringStore, PlaytestSnapshot } from "@rowcat/authoring";
import type {
	ConversationDebugState,
	ConversationDebugStore,
	ConversationSession,
	GenerationPreference,
} from "@rowcat/chat";
import { createConversationDebugStore } from "@rowcat/chat";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { newLocalId, nowIso } from "../../lib/local-data/clock.ts";
import { useAuthoringScope } from "../../lib/local-data/scope.tsx";
import {
	type ChatGenerationState,
	useChatGeneration,
} from "../chat/generation/use-generation.ts";
import { createPlaytestConversation } from "./playtest-conversation.ts";
import {
	createPlaytestState,
	type PlaytestMessage,
	type PlaytestState,
	resetPlaytestConversation,
	selectPlaytestStartScene,
	setPlaytestPreference,
} from "./playtest-session.ts";

/**
 * State of the playtest screen — **one temporary conversation, owned by React.**
 *
 * There is no store. This hook touches the local database only **when it re-reads the draft**
 * (`loadPublicationSource` — called only by `New test with the latest draft`), and the conversation is written
 * nowhere, so it disappears when the screen is left.
 *
 * Generation goes through **the same hook** as the conversation screen
 * (`features/chat/generation/use-generation.ts`). What this file produces is only the answers to
 * the questions that hook asks of the conversation. Prompt assembly, safety guards, target
 * resolution, sending, the stream-ending rules and billing invalidation are none of them here.
 *
 * ## Why not build a second generation engine
 *
 * `generation-turn.ts` already runs on one `ConversationSession` alone, and that file's header
 * names the playtest in advance (the comment on `ConversationSession.token` in `@rowcat/chat` says
 * the same). Copying it diverges in a predictable direction: one side loosens the adult gate, or
 * one side forgets the managed billing invalidation. Neither breaks compilation.
 *
 * ## How late results are blocked — there are two axes
 *
 * This does not rely on `AbortController`. A request that has already received its whole body
 * passes through the abort signal and ends normally, and its confirming save arrives as a
 * **success**, not a failure.
 *
 * ```text
 * history version    rewriteHistory raises it **synchronously**   ← the one that actually blocks
 * session identity   reset and reload create a new object          ← a second net, arriving after render
 * ```
 *
 * The first comes first because of timing. Even when a new session object is created, its identity
 * reaches the generation hook only **after** React re-renders, while the confirming block of a
 * just-aborted stream runs in an earlier microtask. That window is exactly where a late response
 * attaches. So every operation that discards the conversation goes through
 * `generation.rewriteHistory` (see `discardConversation` below).
 */

export interface PlaytestController {
	/** The test running now. The snapshot does not change for the life of this session. */
	snapshot: PlaytestSnapshot;
	messages: PlaytestMessage[];
	/** Playback-only start-scene choice. `null` means the draft's default opening. */
	startSceneId: string | null;
	/** Generation override used only in this test. */
	preference: GenerationPreference;
	generation: ChatGenerationState;
	/** Clears only the conversation — the snapshot, the choice and the override stay. */
	resetConversation: () => void;
	/**
	 * Re-reads the draft and opens a new test. On failure, keeps the current test as it is.
	 *
	 * The value is success or not. The screen needs to be able to say why it failed, but the failure
	 * is either "the draft disappeared" or "the account changed", and neither is a reason to discard
	 * the current conversation.
	 */
	reloadLatestDraft: () => Promise<boolean>;
	/** Changes the playback-only start scene — a new conversation starts. The draft does not change. */
	selectStartScene: (startSceneId: string | null) => void;
	setPreference: (preference: GenerationPreference) => void;
	/**
	 * This session's **observation log** — the values the inspector draws.
	 *
	 * Same model as on the web (`debug-trace.ts` in `@rowcat/chat`). When the session changes, the
	 * whole thing is rebuilt, and a generation in progress at that moment sends its signal to the old
	 * log, which never reaches the screen.
	 */
	debug: ConversationDebugState;
}

/**
 * Identity and time are created outside — the pure functions take them as arguments.
 *
 * `crypto.randomUUID()` is not used because Hermes does not have that function, and this app
 * already has wiring for it (`lib/local-data/clock.ts`). The fact that these values do not go to
 * storage is no reason to skip that generator — a second id rule would eventually fall back to a
 * weak random value in one of them.
 */
const stamp = () => ({ id: newLocalId(), now: nowIso() });

export function usePlaytest(
	initial: PlaytestState,
	/** The scope's owner — one axis of the ownership check (the generation hook uses it as is). */
	viewerId: string | null,
): PlaytestController {
	const { ensureStore, ownsStore } = useAuthoringScope();

	/**
	 * **The source of truth is a ref, and state is its copy.**
	 *
	 * It looks inverted, but there is one reason: a turn's steps are **tighter than React's render
	 * timing**. A pure turn re-reads the history right **after** appending the user's utterance
	 * (`generation-turn.ts` ①②), and only a microtask sits in between, while React's re-render runs in
	 * a later task. If state were the only thing and the ref were synced in an effect, that read would
	 * **not see the utterance just appended**, and the model would answer without knowing what the
	 * user said — and the speech bubble is on screen, so the cause would not be findable.
	 *
	 * `setState(updater)` does not solve it either. That callback runs **at the next render**, so
	 * syncing the ref inside it leaves the same window. So here the ref is set first, and state
	 * receives the already-computed value (every change goes through `update` below, so the two cannot
	 * diverge).
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
	 * This session's observation store — **one per session** (the same arrangement and reason as on
	 * the web).
	 *
	 * It is a ref, not `useMemo`, because of the nature of caches. `useMemo` is an optimization, not a
	 * guarantee, so React may discard it, and then the log would be cleared for no reason.
	 *
	 * The identity issuer is not `crypto.randomUUID` because Hermes lacks it. This app already has
	 * that wiring (`lib/local-data/clock.ts`), and the fact that a value does not go to storage is no
	 * basis for a second id rule.
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
				newTurnId: () => newLocalId(),
			}),
		};
	const debug = debugRef.current.store;

	/**
	 * The first line of this log — **how the session was opened.**
	 *
	 * Written in an effect, not in render. The store notifies synchronously on each change, and if
	 * that notification arrived during render, `useSyncExternalStore` would meet a state update during
	 * render.
	 */
	useEffect(() => {
		/**
		 * **This log has exactly one first line.** StrictMode's double mount runs the effect twice, and
		 * the store survives on the component instance's ref, so the same event would get two lines. In a
		 * timeline that duplicate reads as an event that never happened.
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
	 * Adapter that plugs this conversation into the generation runtime — **the rules live in a pure
	 * module** (`playtest-conversation.ts`). All that remains here is wiring the two ports.
	 *
	 * The `token` is **the session object**: it is the second net of the ownership check (the first is
	 * the history version, which is synchronous — see the header). The dependency is **the one session
	 * object from render**, on purpose. If the adapter were rebuilt each time a message is appended,
	 * its identity would change every turn, and then the generation hook's abort effect would cut an
	 * in-progress generation at its first response. That is why messages live **outside** the session
	 * (`playtest-session.ts`). What the inner operations read is `stateRef`, not the render, so even
	 * if this memo goes stale, reads are current.
	 */
	const session = useMemo<ConversationSession>(
		() =>
			createPlaytestConversation({
				session: state.session,
				read: () => stateRef.current,
				write: update,
				stamp,
			}),
		[state.session, update],
	);

	const generation = useChatGeneration(session, viewerId, { debug });

	/**
	 * Every operation that discards the conversation goes through **`rewriteHistory`.**
	 *
	 * Replacing the session object alone is not enough, which is the point of this wiring. Its
	 * identity reaches the generation hook only **after** React re-renders, while the confirming block
	 * of a just-aborted stream runs at an earlier microtask. In that window a late response attaches
	 * to the conversation that was just cleared.
	 *
	 * `rewriteHistory` exists for this gate: it **raises the version synchronously first**, aborts,
	 * and then commits (`use-chat-generation.ts`). It is the same gate that the conversation screen's
	 * edit, regenerate and delete-from-here pass through. Reset, start-scene change and draft reload
	 * rewrite the whole conversation, so the same gate fits. It does not generate afterwards (the user
	 * asked for a cleanup).
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
			resetPlaytestConversation(current, newLocalId()),
		);
	}, [discardConversation]);

	const selectStartScene = useCallback(
		(startSceneId: string | null) => {
			void discardConversation((current) =>
				selectPlaytestStartScene(current, startSceneId, newLocalId()),
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
		 * If the account changed during the read, **do nothing.** The test on screen is the previous
		 * member's and is cleared soon anyway (the screen state reads the session stage first). Swapping
		 * in someone else's draft here would make that screen draw another person's manuscript for a
		 * frame.
		 *
		 * **Every early return leaves the current test untouched.** Clearing first and then discovering
		 * the failure would lose the user's conversation without them having asked for anything.
		 */
		if (!ownsStore(store)) return false;

		await discardConversation((current) =>
			createPlaytestState({
				source,
				sessionId: newLocalId(),
				/**
				 * The playback-only choice is **carried over.** Re-reading the draft updates the manuscript; it
				 * does not undo the test conditions the user picked. If that start scene was deleted in the
				 * meantime, the factory folds to the default opening.
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
