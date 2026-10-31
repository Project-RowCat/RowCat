import {
	type ChatGenerationEnd,
	type ChatGenerationUsage,
	type ConversationDebugSignal,
	type ConversationDebugSink,
	canStartGeneration,
	chatConversationTools,
	isManagedTarget,
	narrationInjection,
	planChatGeneration,
	promptPackCapabilityFor,
	reasoningCapabilityFor,
	reasoningEffortForRequest,
	resolveAllAges,
	resolveEffectiveGeneration,
	resolveGenerationExecution,
	resolveGenerationOutcome,
	resolveNarrationExecution,
	safeChatRequestDebug,
} from "@rowcat/chat";
import { canUseByoProvider, canViewAdultContent } from "@rowcat/domain";
import { ensurePromptPack } from "@rowcat/prompt-packs";
import {
	generationModelsQueryOptions,
	viewerQueryOptions,
} from "@rowcat/query";
import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { getRowCatClient } from "#/lib/api.ts";
import { useHoldBuildSwitch } from "#/lib/build-freshness/hold.ts";
import { GenerationBlockedError } from "#/lib/generation/availability.ts";
import { streamChatGenerationPlan } from "#/lib/generation/router.ts";
import { useGenerationScope } from "#/lib/local-generation/scope.ts";
import {
	useProviderCredentialScope,
	useProviderScope,
} from "#/lib/local-provider/scope.ts";
import { safeGenerationFailure } from "./generation-debug.ts";
import { ChatPersistenceError, ChatStreamFailure } from "./generation-error.ts";
import {
	type ConversationSessionKey,
	canPersistGeneration,
	type GenerationOwner,
	ownsSession,
	releaseOwnSlot,
} from "./generation-owner.ts";
import type { ConversationSession } from "./session.ts";
import { awaitsAnswer, commitUserTurn } from "./user-turn.ts";

/**
 * The order and failure handling of one turn, shared by all conversation kinds. The order is a
 * product rule, and changing it breaks data:
 *
 * 1. canStartGeneration decides whether starting is allowed.
 * 2. The user message is saved before any network call. It must survive a dropped network or a
 *    closed tab, and the step 3 context must equal the saved state.
 * 3. buildChatGenerationRequest builds context from the saved messages only.
 * 4. The router resolves the target and starts the stream (lib/generation/router.ts).
 * 5. Incoming text stays in React state and is never saved per token. Per-token writes would
 *    mean hundreds of IndexedDB transactions per response.
 * 6. resolveGenerationOutcome decides what to save once the response finishes, and only while
 *    the conversation is still the same (generation-owner.ts).
 *
 * BYO and the work test change only what steps 4, 2, 3 and 6 write through (the router and the
 * passed ConversationSession). Do not add provider or kind branches here, such as `if (provider ===
 * "anthropic")` or `if (kind === "playtest")`. They would make the safety paths diverge per
 * provider or per kind.
 */

export interface ConversationSendOptions {
	/**
	 * Called once the user utterance is saved to the conversation. It is the signal for the input box
	 * to clear its own value.
	 *
	 * The point is that send() returning does not mean the reply is finished. Folding the two into one
	 * signal would force the input to hold the user's text until the model answers, and clearing it
	 * later could erase text the user has begun typing next.
	 *
	 * If saving fails, this is not called. The input keeps the original text, and the user can send it
	 * again. That is the reason this signal exists.
	 */
	onAccepted?: () => void;
}

export interface ConversationGenerationState {
	streamingText: string;
	generating: boolean;
	/** The last failure. Cleared when the next attempt starts. */
	error: Error | null;
	/**
	 * Whether the last user turn went unanswered. This decides whether `Regenerate` is shown.
	 */
	unanswered: boolean;
	/**
	 * Whether the user ended the last turn themselves by stopping. Only meaningful together with
	 * `unanswered`.
	 *
	 * For an unanswered turn, it separates a failure from a stop the user chose. The failure ladder
	 * makes that judgement (generationRecovery). The screen should not infer it from `error`, so the
	 * fact is stored as a boolean.
	 */
	stopped: boolean;
	/**
	 * Starts a turn. `options.onAccepted` fires only after the local commit. The function does not
	 * wait for the assistant's reply and returns no value to wait on.
	 */
	send: (text: string, options?: ConversationSendOptions) => void;
	regenerate: () => void;
	/**
	 * Continues after the last completed response with no input from the user. This is the action the
	 * scroll-to-bottom gesture fires (`advance` in scrollAdvanceAction).
	 *
	 * The request takes the same path as `regenerate`: one turn without input. If the history ends
	 * with an assistant message, the request assembler adds a nudge to advance the scene, and the
	 * reply appears as a new bubble.
	 *
	 * The name is separate because the meaning differs. `regenerate` answers a turn that got no
	 * answer, while this advances a conversation that already has answers. Folding both under one name
	 * would make the conditions for showing 'regenerate' and for this gesture look the same. The
	 * screen chooses the target.
	 */
	advance: () => void;
	/**
	 * Continues the last response, which was cut by the output limit, in the same bubble.
	 *
	 * Unlike `regenerate`, which adds a new answer after the cut one, this writes on from the exact
	 * character where the sentence stopped (prefill). It deletes nothing, so it does not go through
	 * rewriteHistory and does not bump the epoch. An edit or delete during continuation does bump the
	 * epoch, and then the result cannot reach storage, which is the same rule as ordinary generation.
	 *
	 * The screen decides whether the target is valid (continuationTarget). This function does not
	 * repeat that check, but if the session does not support continuation it silently does nothing.
	 */
	continueGeneration: (messageId: string) => void;
	/**
	 * Whether this conversation supports continuation. This is the basis for showing `Continue generating`
	 * (continue generating). It derives from the optional session capability extendAssistantMessage.
	 * The work test does not provide that capability, so it is false there, and that screen shows
	 * neither the banner nor the scroll trigger.
	 */
	canContinue: boolean;
	stop: () => void;
	/**
	 * Rewrites the history. This is the only door that editing, regenerating and deleting-from-here
	 * pass through.
	 *
	 * The storage operation itself is the function the caller passes in. This hook wraps it because it
	 * owns generation ownership. It stops any generation in progress and bumps the epoch, so a
	 * generation that runs to completion cannot reach storage. Only then is the rewrite committed. If
	 * the screen created its own AbortController, nobody could explain when the two ownerships fall
	 * out of sync.
	 *
	 * With `regenerate: true`, generation continues after the commit. Saving and generating are still
	 * two operations. The second reads the history the first committed.
	 */
	rewriteHistory: <T>(
		perform: () => Promise<T>,
		options?: {
			/**
			 * Decides from the commit result whether to continue generating. It is a predicate, not a
			 * boolean, because the rewrite may have changed nothing (its anchor disappeared in between).
			 * Starting a generation then would attach an answer to an edit the user had cancelled.
			 */
			regenerate?: (result: T) => boolean;
		},
	) => Promise<T>;
}

/**
 * Optional parameters of this lifecycle. Today there is only observation.
 *
 * It is an object so the names show at the call site. `useConversationGeneration(session, sink)`
 * reads clearly only when its arguments are named. Not passing it leaves this file behaving exactly
 * as it did before instrumentation existed.
 */
export interface ConversationGenerationOptions {
	/**
	 * The observation sink. Without it, nothing happens.
	 *
	 * Product conversations (local rooms) do not pass one. Only the work test does, and its records
	 * live in memory and vanish with the session (debug-trace.ts in @rowcat/chat).
	 */
	debug?: ConversationDebugSink | null;
}

export function useConversationGeneration(
	session: ConversationSession | null,
	options: ConversationGenerationOptions = {},
): ConversationGenerationState {
	/**
	 * The sink is captured by the callback as the render's value, not through a ref. Its identity is
	 * the playtest session's identity (one session, one store), so the callback is recreated when the
	 * session changes. A generation already in flight keeps the old sink in its closure, so when that
	 * old turn's signal arrives late, it does not attach to the new session's record. This is one
	 * result of the same axis that ownership checks use to block saves, and it is a separate safety
	 * net.
	 */
	const debug = options.debug ?? null;
	/**
	 * Reads the global generation preference directly from the store, not from subscription state
	 * (local-generation/hooks.ts). Going through render state causes two problems. A tab that just
	 * changed the value may not have received it yet, and which setting a request went out with would
	 * depend on render timing.
	 *
	 * It is read once at start and frozen here, so the snapshot rule holds structurally: an in-flight
	 * generation keeps its starting settings to the end. The same scope also provides viewerId, which
	 * is one axis of the ownership check and is independent of the domain.
	 */
	const { store: preferences, viewerId } = useGenerationScope();
	/**
	 * Reads provider connections directly from the store, for the same reason as preferences. With a
	 * subscription, a connection that was just cut in another tab may still look connected in this
	 * window, and a request started from here would expect a credential that no longer exists.
	 */
	const { store: providers } = useProviderScope();
	/**
	 * The port that opens credentials. This hook never sees plaintext. It passes the port straight to
	 * the router, and decryption happens only when an adapter is called (lib/local-provider/store.ts).
	 */
	const { store: credentials } = useProviderCredentialScope();
	const client = getRowCatClient();
	/**
	 * The catalog is used only to check inference capability.
	 *
	 * It is not passed to availability judgement (resolveGenerationExecution). If it were, failing to
	 * read server state would block conversations, while a model that truly does not exist is rejected
	 * by the provider anyway. That rule is unchanged.
	 *
	 * It is needed here because the BYO path has no server re-check, so this browser is the last place
	 * that can confirm the model supports the reasoning step. If it cannot confirm, no parameter is
	 * sent and the request matches the pre-axis request. Managed requests are normalized by the
	 * server, so they are correct either way. reasoningEffortForRequest holds that asymmetry.
	 *
	 * The query key is the same one the settings screen uses. This screen makes one extra request, but
	 * it is cached for 10 minutes, so it does not happen per conversation. It never blocks generation:
	 * if the result has not arrived, the capability is simply unknown.
	 */
	const catalog = useQuery(generationModelsQueryOptions(client));
	const viewer = useQuery(viewerQueryOptions(client)).data ?? null;

	const [streamingText, setStreamingText] = useState("");
	const [generating, setGenerating] = useState(false);
	const [error, setError] = useState<Error | null>(null);
	const [unanswered, setUnanswered] = useState(false);
	/**
	 * Whether the last turn ended with a stop. Read in the same place as `unanswered`, and only there.
	 */
	const [stopped, setStopped] = useState(false);
	/**
	 * A reply still streaming is saved by this hook's unmount (the abort lands in `run`'s finally). A
	 * document load would skip that, so a stale tab leaves this conversation as a client navigation
	 * while one is in flight (lib/build-freshness/).
	 */
	useHoldBuildSwitch(generating);

	const abortRef = useRef<AbortController | null>(null);
	/**
	 * A synchronous copy of 'is generating'. The generating state alone is not enough. setState
	 * applies on the next render, so two requests arriving in the same tick (Enter mashing, Enter
	 * during an IME commit, a retry called from outside) both see generating as false and both pass.
	 * The same turn would then get two responses saved, and that conversation would stay inconsistent
	 * afterward.
	 *
	 * A ref is visible the moment it is assigned, so that window does not exist. The screen display
	 * still uses state.
	 */
	const generatingRef = useRef(false);
	/** Accumulated raw text, independent of screen updates. The final save reads this value. */
	const bufferRef = useRef("");
	const frameRef = useRef<number | null>(null);
	/** Blocks setState after unmount. Saving continues, since saving is independent of the screen. */
	const mountedRef = useRef(true);

	/**
	 * The current generation's owner and its abort handle. It is kept apart from `abortRef` because
	 * the meanings differ. That one is the stop the user can press. This one is which conversation the
	 * generation belongs to. Merging them would tie the ownership check to the lifetime of the stop
	 * button.
	 */
	const ownerRef = useRef<
		(GenerationOwner & { controller: AbortController }) | null
	>(null);
	/**
	 * The latest identity of the currently open conversation. The closure of `run` captures the value
	 * from start time, so it cannot be used for the ownership check right before the final save.
	 *
	 * Updating it in an effect rather than during render is intentional. The scope itself opens and
	 * closes in an effect (LocalDataScopeProvider), so the value read in the same cycle matches the
	 * actual state.
	 */
	const keyRef = useRef<ConversationSessionKey>({
		viewerId,
		session: session?.token ?? null,
	});
	/**
	 * The history epoch. A tail rewrite increments it.
	 *
	 * It is a ref, not state, because the value is not used in rendering. It is only used for checks,
	 * and it must be visible the moment it is assigned. With setState, if a rewrite and the final save
	 * overlap in the same tick, the save would still read the old epoch.
	 */
	const historyEpochRef = useRef(0);
	/**
	 * The promise of the run currently in progress, used to queue the next generation.
	 *
	 * generatingRef alone is not enough. Right after a rewrite, if generation resumes immediately, the
	 * generation just cut has not reached its finally yet, so the flag is still set.
	 * canStartGeneration then silently rejects the new request, and to the user 'regenerate' appears
	 * to do nothing. run does not reject (it moves its own failure into state), so waiting on it is
	 * safe.
	 */
	const settleRef = useRef<Promise<void>>(Promise.resolve());

	/**
	 * Folds screen updates per animation frame.
	 *
	 * Providers send deltas dozens of times per second. Calling setState for each one would re-render
	 * that many times, and on long responses typing would stutter. The browser paints once per frame
	 * anyway, so folding on that cadence gives the same visible result with far fewer renders.
	 *
	 * The final text must be exact. Only the intermediate display is folded. The save always uses the
	 * raw text in bufferRef.
	 */
	const scheduleFlush = useCallback(() => {
		if (frameRef.current !== null) return;
		frameRef.current = requestAnimationFrame(() => {
			frameRef.current = null;
			if (mountedRef.current) setStreamingText(bufferRef.current);
		});
	}, []);

	const cancelFlush = useCallback(() => {
		if (frameRef.current === null) return;
		cancelAnimationFrame(frameRef.current);
		frameRef.current = null;
	}, []);

	/**
	 * Stops the generation in progress when the screen is left. Otherwise the model keeps generating,
	 * its tokens keep arriving, and the socket stays open. When the abort fires, the finalization
	 * block in run (below) saves the partial response already received. Text the user was reading is
	 * not discarded just because they left the screen.
	 */
	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
			cancelFlush();
			abortRef.current?.abort();
		};
	}, [cancelFlush]);

	/**
	 * Stops the generation in progress when the conversation's owner changes. Two cases hit this.
	 *
	 * One is logout and account switching. Without it, Alice's generation keeps running under Bob's
	 * session, and when it ends, Alice's database is already closed. The other is the work test's
	 * 'reset test' and 'new test from latest draft'. When a new session object arrives, the earlier
	 * generation loses its conversation.
	 *
	 * A partial response is not saved by reopening the old conversation. Identity isolation outranks
	 * preserving partial responses. Code that quietly reopened a logged-out account's store would make
	 * it impossible to explain when that code runs.
	 *
	 * The comparison uses the two values inside the key object (ownsSession), not the key's reference.
	 * If React created a new object in a render where nothing changed, stopping a healthy generation
	 * would be a bug, not an account switch.
	 */
	useEffect(() => {
		const key: ConversationSessionKey = {
			viewerId,
			session: session?.token ?? null,
		};
		keyRef.current = key;
		const owner = ownerRef.current;
		if (owner && !ownsSession(owner, key)) owner.controller.abort();
	}, [viewerId, session]);

	const run = useCallback(
		async (
			text: string,
			allowEmpty: boolean,
			options?: ConversationSendOptions,
			/**
			 * The target message id for 'continue generating'. If present, this turn is a continuation: no
			 * user utterance is appended, the request is assembled with a prefill, and the commit extends
			 * the message rather than appending a new one.
			 */
			continueId?: string,
		) => {
			if (!session) return;
			const continuing = continueId !== undefined;
			// Conversations without append capability (the work test) do not start a continuation.
			if (continuing && !session.extendAssistantMessage) return;
			if (
				!canStartGeneration({
					text,
					generating: generatingRef.current,
					ready: true,
					allowEmpty,
				})
			)
				return;

			generatingRef.current = true;
			/**
			 * This turn's observation identity is issued only after the start is confirmed. Placing it
			 * before the two rejections above (a conversation that cannot continue, a generation already
			 * running) would record a turn that never started. That row would have no events and stay
			 * `running` forever, which lies to the question the inspector has to answer: why does this turn
			 * have no answer?
			 */
			const turnId =
				debug?.beginTurn(
					continuing ? "continue" : allowEmpty ? "regenerate" : "send",
				) ?? null;
			/**
			 * When instrumentation is off, nothing happens. That single line is the whole fact.
			 *
			 * The function is passed in so that even building the signal is deferred. Without a sink the
			 * function is never called, so product conversations create no prompt traces and do no string
			 * counting.
			 */
			const note = (
				build: (turnId: string) => ConversationDebugSignal,
			): void => {
				if (debug && turnId !== null) debug.emit(build(turnId));
			};
			const controller = new AbortController();
			abortRef.current = controller;
			/**
			 * Ownership is fixed here. After this point, even if the scope changes, the target this
			 * generation writes to is the conversation it started with. If that conversation is no longer
			 * active, nothing is written.
			 */
			const owner: GenerationOwner = {
				viewerId,
				session: session.token,
				historyEpoch: historyEpochRef.current,
			};
			ownerRef.current = { ...owner, controller };

			bufferRef.current = "";
			setStreamingText("");
			setError(null);
			setUnanswered(false);
			setGenerating(true);

			/**
			 * The start value is `failed`, and that matters. If it were `completed`, every path that fails
			 * to confirm a normal finish would be logged as completed.
			 *
			 * The only basis for completion is one event: the server's `done` event. The value is raised
			 * below only when that event was actually received. The SDK enforces the same protocol
			 * invariant: a stream that ends without a terminal event is raised as an error.
			 */
			let end: ChatGenerationEnd = "failed";
			let failure: Error | null = null;
			let usage: ChatGenerationUsage | undefined;
			/**
			 * `done` carries the provider's raw finish reason. Normalization is done by @rowcat/chat
			 * (continuation.ts).
			 */
			let finishReason: string | undefined;
			/**
			 * Whether the final assistant message was actually saved. outcome.unanswered is not used
			 * directly. That value says whether there is something to save. Whether the save really happened
			 * is answered by the write after it. A turn whose save failed, or was skipped because ownership
			 * had passed, counts as unanswered.
			 */
			let saved = false;
			/**
			 * Whether this attempt's user utterance is already in the conversation.
			 *
			 * A regenerate (allowEmpty) starts as true, because that turn's utterance is already in the
			 * history and this attempt only makes the answer again. A new utterance becomes true only after
			 * its save completes.
			 *
			 * Without this flag, an attempt whose save failed would be marked as an unanswered turn, and the
			 * screen would show `Regenerate` on top. That button generates from the past history, so
			 * the sentence the user just typed would appear nowhere, and an extra answer would be attached.
			 */
			/**
			 * Continuation starts as false and stays false to the end.
			 *
			 * If a failed continuation were marked as a turn awaiting an answer, the screen would show
			 * `Regenerate`. That button attaches a new bubble after the truncated reply, but the user wanted a
			 * continuation. Even if the continuation fails, `truncated` stays set, so `Continue generating` (continue
			 * generating) appears again, and that is the right retry.
			 */
			let userTurnCommitted = continuing ? false : allowEmpty;
			/**
			 * Whether the request actually went out to the provider. This is the basis for recording the end
			 * of the round trip.
			 *
			 * If the end were recorded without this flag, a turn whose utterance save failed before reaching
			 * the request would show 'response finished' in the timeline. A failed round trip and a round
			 * trip that never happened call for different user actions.
			 */
			let requested = false;

			try {
				try {
					/**
					 * Step ①: save the user message first. For a local room, the room's activity time advances in
					 * the same transaction. The screen draws from the result, so the bubble reflects what the
					 * conversation actually holds, with no separate optimistic copy. Two copies of the truth would
					 * disagree.
					 *
					 * The input box is cleared at this point too. onAccepted fires only when this commit succeeds.
					 * If it fails, the throw skips the send step below, so there is no structural path for a
					 * request built on an unsaved utterance to go out.
					 */
					let committed: boolean;
					try {
						committed = await commitUserTurn({
							session,
							text,
							onAccepted: options?.onAccepted,
						});
					} catch (thrown) {
						/**
						 * The utterance could not be saved, so this turn did not happen.
						 *
						 * The code only records the event and rethrows as is. Swallowing the error would send a
						 * request whose context includes an utterance that was never saved. This ordering exists to
						 * make that path impossible.
						 */
						note((id) => ({
							kind: "input-rejected",
							turnId: id,
							data: {
								reason: thrown instanceof Error ? thrown.name : "unknown",
							},
						}));
						throw thrown;
					}
					if (committed) {
						userTurnCommitted = true;
						note((id) => ({
							kind: "input-accepted",
							turnId: id,
							data: { characters: text.trim().length },
						}));
					}

					/**
					 * Step ②: read back what was saved to build the context. It is not appended from memory,
					 * because order matters. The order the conversation fixed is the next turn's history, so the
					 * assembly must see the same order.
					 */
					const history = await session.loadHistory();

					/**
					 * Precondition for a continuation: the history still ends with an assistant message.
					 *
					 * The target was the last message (continuationTarget on screen). If the conversation advanced
					 * between the button press and this read, the precondition is broken. Proceeding would attach
					 * a nudge and turn the request into an ordinary generation, and its result would be appended
					 * after a truncated message, so another question's answer would stand after someone else's
					 * sentence. Giving up quietly is correct, since a new turn in between is already running its
					 * own generation.
					 */
					if (continuing && history[history.length - 1]?.role !== "assistant") {
						note((id) => ({
							kind: "turn-discarded",
							turnId: id,
							data: { reason: "precondition" },
						}));
						return;
					}

					/**
					 * Step ②-a: read memories once and freeze them. This is a direct read, not a subscription.
					 *
					 * This line is the whole snapshot rule. If the user edits or deletes memories while the
					 * response streams, this request still completes with the version from the start, and the next
					 * request reads the new version. Going through render state would make 'which memories this
					 * request went out with' depend on render timing, which cannot be reproduced. The generation
					 * preference below uses the same shape for the same reason.
					 *
					 * Nothing is trimmed or formatted here. Budget decisions and block assembly all happen inside
					 * buildChatGenerationRequest. If this hook started building prompt strings, the BYO and
					 * managed paths, and the real conversation and the work test, would end up with different
					 * contexts.
					 */
					const memories = await session.loadMemories();
					/**
					 * Characters introduced in this conversation are frozen at the same moment as memory. A
					 * character added while the response streams does not change this request, which ends with the
					 * roster from the start. The next turn reads the new roster.
					 */
					const characters = await session.loadCharacters();

					/**
					 * Step ②-c: the summary is also a snapshot taken at the same moment.
					 *
					 * It is read alongside memory for the same reason. Background maintenance can update the
					 * summary during a response. If this request picked up the new version, 'which context this
					 * request went out with' would depend on the timing of another task rather than on the render.
					 */
					const summary = await session.loadSummary();

					/**
					 * Step ②-e: secure this conversation's routing key. Some conversations have none.
					 *
					 * Unlike the four values read alongside it, this is an acquisition, not a snapshot. The value
					 * lives in the room record and never changes once set (ChatRoom header). So reading at start
					 * and reading at end return the same value. It is called here because a room created under an
					 * older version gets a key issued and saved at this point.
					 *
					 * The work test session does not have this function. Its requests go out without this axis,
					 * which matches the request from before this feature existed.
					 */
					const routingSessionId =
						(await session.loadRoutingSessionId?.()) ?? null;

					/**
					 * Step ②-b: freeze this turn's effective generation settings, resolved as conversation over
					 * global over product default.
					 *
					 * Reading them once into a local variable is the whole snapshot. If the user changes settings
					 * during the response, this request still ends with the starting values, and the next request
					 * reads the new ones. This is how the product rule holds: an in-flight generation is not cut
					 * or altered by a settings change.
					 *
					 * If the preference store is absent (the scope is not open yet, or failed to open), resolution
					 * uses an empty layer. Product defaults apply, and the result matches the time before this
					 * feature existed. A single unreadable setting must not block the conversation. That would be
					 * a malfunction, not a setting.
					 */
					const effective = resolveEffectiveGeneration({
						global: await preferences?.getGlobal(),
						room: await session.loadPreference(),
					});

					/**
					 * Step ②-c: requested target to executable target. This is the other half of the snapshot.
					 *
					 * The connection list is also read once and frozen here. The request therefore ends with the
					 * providers connected at start. If another tab disconnects during the response, the generation
					 * in flight is not cut. It also means the code does not try to retroactively cancel an HTTP
					 * request that has already left.
					 *
					 * The catalog is not passed here. If a conversation were blocked because server state could
					 * not be read, that would be a malfunction. If the model truly does not exist, the provider
					 * rejects it (see the resolveGenerationExecution comment in @rowcat/chat).
					 */
					const connected = (await providers?.list())?.map(
						(connection) => connection.provider,
					);
					const execution = resolveGenerationExecution({
						target: effective.target,
						connectedProviders: connected ?? [],
						/**
						 * Account eligibility is also frozen here. The viewer is already subscribed, so this adds no
						 * extra lookup. Ending with the start-time value follows the snapshot rule: if age is
						 * confirmed mid-response, the in-flight request is not cut retroactively.
						 *
						 * Managed targets are unaffected. This axis applies only to BYO providers
						 * (resolveGenerationExecution). Managed generation for members under 14 stays open.
						 */
						byoAllowed: canUseByoProvider(viewer),
						/**
						 * A protected copy's room runs only on RowCat-provided models. Its manuscript is assembled by
						 * the server, and in BYO the browser calls the provider directly, so there is no prompt on
						 * the device to send.
						 */
						managedOnly: session.protectedStoryId !== undefined,
					});

					/**
					 * If blocked, stop here. Do not fall back to another provider.
					 *
					 * The user message is already saved (step ①). That is correct: the user did send it, and they
					 * must be able to connect a provider and continue with `Regenerate`. The saved
					 * preference is left untouched too. Once reconnected, this conversation runs unchanged.
					 */
					if (execution.status === "blocked")
						throw new GenerationBlockedError(execution);

					/**
					 * Step ②-e: the narration pack, where three pieces connect.
					 *
					 * - What this conversation chose: session.loadNarration(), from the room record.
					 * - What this model can do: promptPackCapabilityFor(), from the server catalog.
					 * - The actual body: ensurePromptPack(), a lazily loaded chunk.
					 *
					 * Capability must be read from execution.target, not effective.target. The former is the
					 * target that actually runs this turn. The latter is what the user asked for. Reading the
					 * latter could send a request where the pack and the model disagree.
					 *
					 * If the body cannot be loaded (a chunk load failure, or a stale pointer to a nonexistent
					 * combination), the value folds to null. The prompt is then byte-identical to the one from
					 * before this axis existed. narrationInjection prevents the state where only the protective
					 * sentence drops out.
					 */
					const narrationExecution = resolveNarrationExecution({
						settings: (await session.loadNarration?.()) ?? null,
						capability: promptPackCapabilityFor({
							models: catalog.data ?? [],
							catalogLoaded: catalog.isSuccess,
							target: execution.target,
						}),
					});
					const narration = narrationInjection(
						narrationExecution,
						narrationExecution
							? await ensurePromptPack(narrationExecution.packKey)
							: "",
					);

					/**
					 * The rating judgement uses the same function as a real conversation. The work's rating takes
					 * priority, and membership eligibility is layered on top. A work test therefore cannot loosen
					 * the adult gate.
					 *
					 * The local variable lifted out of the assembly arguments exists for observation. The
					 * inspector must record this value, so it has to be readable outside the assembler. Computing
					 * it twice would create a place where the rating the screen records and the rating the prompt
					 * was built with could diverge.
					 */
					const allAges = resolveAllAges(session.runtime, {
						adultAllowed: canViewAdultContent(viewer),
					});
					/**
					 * Step ②-d: requested step to a step this model can execute. It has the same shape as the
					 * target judgement: a second snapshot.
					 *
					 * Capability is not guessed here. The catalog answers. If it has no answer, behavior depends
					 * on the path: managed requests are decided by the server, and for BYO this spot is the last
					 * check.
					 */
					const reasoningEffort = reasoningEffortForRequest({
						target: execution.target,
						effort: effective.reasoningEffort,
						capability: reasoningCapabilityFor({
							models: catalog.data ?? [],
							catalogLoaded: catalog.isSuccess,
							target: execution.target,
						}),
					});
					const assemblyInput = {
						room: session.runtime,
						messages: history,
						memories,
						characters,
						summary,
						allAges,
						maxOutputTokens: effective.maxOutputTokens,
						reasoningEffort,
						// A continuation ends with a prefill. Adding the nudge would make the model start a new turn.
						...(continuing ? { continuation: true } : {}),
						/*
						 * This axis does not change the prompt by a single character. Without a value no key is
						 * created, so requests from conversations without this capability match the earlier ones.
						 */
						...(routingSessionId ? { routingSessionId } : {}),
						/*
						 * Without a value, no key is created. Requests from conversations that do not use a narration
						 * pack are byte-identical to requests from before this axis existed.
						 */
						...(narration ? { narration } : {}),
					};
					/**
					 * Decides once where to assemble (planChatGeneration). A normal room assembles here. For a
					 * prompt-protected room, only the part of the assembly arguments this device holds is sent to
					 * the server, because the manuscript is not on this device.
					 *
					 * With instrumentation on, the same assembler's other entry point is used. Both go through one
					 * implementation (buildChatGenerationRequestTraced is a one-line delegate), so the request
					 * sent is identical either way. That this is guaranteed by structure rather than by promise is
					 * what makes this branch safe.
					 */
					const plan = planChatGeneration({
						assembly: assemblyInput,
						protectedStoryId: session.protectedStoryId ?? null,
						trace: Boolean(debug) && turnId !== null,
					});
					if (plan.kind === "assembled" && plan.trace) {
						const promptTrace = plan.trace;
						const request = plan.request;
						note((id) => ({
							kind: "prompt-assembled",
							turnId: id,
							data: {
								prompt: promptTrace,
								request: safeChatRequestDebug(request),
							},
						}));
					}

					/**
					 * Step ③: stream. Incoming text is not saved. It flows only as screen state.
					 *
					 * Whether the transport is managed or BYO is not visible here. The router takes one target and
					 * decides. The loop reads the same ChatStreamEvent either way.
					 */
					const routerDeps = {
						client,
						credentials: credentials ?? null,
						/**
						 * What this conversation may call. The registration lives here because the data the tool
						 * reads is on this device. Lore sits inside the room record and does not pass through
						 * storage, but once a tool reads memory or characters, that access is created here.
						 *
						 * A room with no lore to find gets an empty array. The router then does not wrap the
						 * transport, and the request is byte-identical to one from before this axis existed.
						 */
						toolAccess: {
							tools: chatConversationTools(session.runtime),
							/**
							 * A generation that can no longer be saved makes no further round trips.
							 *
							 * Using the same predicate as the final save is the point. The two questions have different
							 * results (one saves, the other allows the next request), but the axis is the same: does
							 * this response still belong to its conversation? Splitting them would let round trips
							 * continue after the user has left the room, spending tokens on a sentence nobody will read.
							 */
							isValid: () =>
								canPersistGeneration(
									owner,
									keyRef.current,
									historyEpochRef.current,
								),
						},
					};
					/**
					 * Record the target that actually runs, not the target requested. Recording the requested one
					 * would leave the inspector unable to answer 'the answer came from a model other than the one
					 * I chose'.
					 */
					requested = true;
					note((id) => ({
						kind: "provider-request",
						turnId: id,
						data: {
							target: execution.target,
							managed: isManagedTarget(execution.target),
							reasoningEffort,
							responseLength: effective.responseLength,
							maxOutputTokens: effective.maxOutputTokens,
							allAges,
							narrationApplied: narration !== null,
						},
					}));
					for await (const event of streamChatGenerationPlan(
						plan,
						execution.target,
						routerDeps,
						{ signal: controller.signal },
					)) {
						if (event.type === "delta") {
							bufferRef.current += event.text;
							scheduleFlush();
						} else if (event.type === "usage") {
							/**
							 * An axis that is not reported creates no key. Cache metrics are missing entirely for some
							 * providers and models. Filling them with 0 would make 'the cache did nothing' and 'the
							 * provider did not report it' indistinguishable in storage.
							 *
							 * Cache values are also kept out of React state on purpose. The screen does not read them,
							 * and putting them in state would re-render the whole conversation on every usage frame.
							 */
							usage = {
								...(event.model !== undefined ? { model: event.model } : {}),
								...(event.inputTokens !== undefined
									? { inputTokens: event.inputTokens }
									: {}),
								...(event.cachedInputTokens !== undefined
									? { cachedInputTokens: event.cachedInputTokens }
									: {}),
								...(event.cacheWriteInputTokens !== undefined
									? { cacheWriteInputTokens: event.cacheWriteInputTokens }
									: {}),
								...(event.outputTokens !== undefined
									? { outputTokens: event.outputTokens }
									: {}),
							};
						} else if (event.type === "error") {
							/**
							 * A failure after the stream has started. Stop here but do not throw, because text already
							 * received must be saved below. The code is carried through intact because a settlement
							 * failure and a provider failure mean different things to the user. The first leaves the
							 * received text in place. The second means the response was cut off.
							 */
							failure = new ChatStreamFailure(event.code, event.message);
							break;
						} else if (event.type === "done") {
							// done was actually received. This is the only basis for recording completion.
							end = "completed";
							/**
							 * The finish reason also comes only from here. It is kept as the raw provider string
							 * (length, max_tokens, MAX_TOKENS). The truncation judgement is made by the save rule. If
							 * the screen started branching on this string, it would not know the new vocabulary when
							 * another provider is added.
							 */
							finishReason = event.finishReason;
						}
					}
				} catch (thrown) {
					/**
					 * The user stopped, left the screen, or the account changed. AbortError is an intended end,
					 * not a failure, so no error screen is shown. The partial response is still preserved in the
					 * same way, as long as ownership is unchanged.
					 */
					if (controller.signal.aborted) end = "stopped";
					else
						failure =
							thrown instanceof Error ? thrown : new Error(String(thrown));
				}

				/**
				 * The round trip with the provider is over. Record it before the commit.
				 *
				 * The order carries meaning. This event and the commit that follows must be separate, so the
				 * timeline reads 'the response arrived but was not saved'.
				 */
				if (requested)
					note((id) => ({
						kind: "provider-response",
						turnId: id,
						data: {
							end,
							outputCharacters: bufferRef.current.length,
							/** If not reported, this is null. It is not filled with 0. */
							usage: usage ?? null,
							finishReason: finishReason ?? null,
						},
					}));
				if (failure) {
					const projected = safeGenerationFailure(failure);
					note((id) => ({
						kind: "generation-failed",
						turnId: id,
						data: projected,
					}));
				}

				/**
				 * Step ④: commit. A pure function (@rowcat/chat) decides what to save: the rules for normal
				 * completion, stop, failure and partial failure. They are kept out of screen code.
				 */
				cancelFlush();
				if (continueId !== undefined) {
					/**
					 * A continuation's commit is extend, not append. How the two merge (appending the body,
					 * summing usage, the scene image, display cleanup) is enforced by the store as a shared rule
					 * (extendAssistantRecord). An empty continuation changes nothing under that rule. Filtering it
					 * here too only keeps `saved` honest.
					 *
					 * The ownership check is the same gate as an ordinary generation. If an edit, delete or
					 * account switch happens during continuation, this result cannot reach storage. Because
					 * `truncated` stays set, the user can continue again.
					 */
					/**
					 * The decision is made once, and the record and the save share it.
					 *
					 * Asking twice would split the record from reality if an await slips between the two. The
					 * inspector would record 'not saved' while the conversation shows the answer attached. That is
					 * the opposite of why this feature exists.
					 */
					const hasBody = Boolean(bufferRef.current.trim());
					const persistable = canPersistGeneration(
						owner,
						keyRef.current,
						historyEpochRef.current,
					);
					if (!hasBody)
						note((id) => ({
							kind: "turn-discarded",
							turnId: id,
							data: { reason: "empty" },
						}));
					else if (!persistable)
						note((id) => ({
							kind: "turn-discarded",
							turnId: id,
							data: { reason: "ownership" },
						}));

					if (hasBody && persistable) {
						await session.extendAssistantMessage?.(continueId, {
							text: bufferRef.current,
							end,
							...(usage ? { usage } : {}),
							...(finishReason !== undefined ? { finishReason } : {}),
							sceneImages: session.runtime.seed.sceneImages,
						});
						saved = true;
						/** A continuation attaches to the existing line. No new identity is created. */
						note((id) => ({
							kind: "turn-committed",
							turnId: id,
							data: { messageId: continueId },
						}));
						// The appended body also means the conversation has grown. That is the same trigger as an
						// ordinary save.
						try {
							session.maintain?.();
						} catch {
							// Maintenance problems are not this turn's concern. The user is already reading their
							// answer.
						}
					}
				} else {
					const outcome = resolveGenerationOutcome({
						text: bufferRef.current,
						end,
						...(usage ? { usage } : {}),
						/**
						 * Also pass the finish reason. A completion cut off by the output limit stays `truncated`,
						 * which is the basis for `Continue generating`. Normalization belongs to the pure
						 * function.
						 */
						...(finishReason !== undefined ? { finishReason } : {}),
						/**
						 * Attaching the scene image is also done by that pure function. Doing it here would create a
						 * second copy of the rule in mobile, and the two would eventually diverge.
						 *
						 * It is read from the seed because it must be the picture this conversation started with. The
						 * room is a self-contained copy taken at acquisition time. Even if the work changes its
						 * picture later, this room's scene does not change.
						 */
						sceneImages: session.runtime.seed.sceneImages,
					});

					/**
					 * Ownership has passed, so do not write, even if there is something to save. This response
					 * either belongs to an account that has logged out, or to a test the user has just reset.
					 * Identity and the conversation boundary outrank a partial response.
					 */
					const persistable = canPersistGeneration(
						owner,
						keyRef.current,
						historyEpochRef.current,
					);
					if (!outcome.message)
						note((id) => ({
							kind: "turn-discarded",
							turnId: id,
							data: { reason: "empty" },
						}));
					else if (!persistable)
						note((id) => ({
							kind: "turn-discarded",
							turnId: id,
							data: { reason: "ownership" },
						}));

					if (outcome.message && persistable) {
						/**
						 * The mapping is decided by the conversation. If the screen later guessed that the last line
						 * belongs to the last turn, one generation finishing late would break that guess, and the
						 * inspector would attribute another turn's prompt to this response.
						 */
						const messageId = await session.appendAssistantMessage(
							outcome.message,
						);
						saved = true;
						note((id) => ({
							kind: "turn-committed",
							turnId: id,
							data: { messageId: messageId ?? null },
						}));
						/**
						 * Wake automatic maintenance after the save, and do not wait for it.
						 *
						 * There are two reasons for this spot. One is timing: whether maintenance is needed depends
						 * on how many messages have accumulated, and that value changes at exactly this line. The
						 * other is correctness: waking it before the save would make maintenance choose batches over
						 * a history that lacks the response just produced, and that response would be left out of the
						 * summary until the next run.
						 *
						 * A failure here is unrelated to this turn. The port is designed not to throw
						 * (ConversationSession.maintain). If that promise breaks as wiring grows, an escaped
						 * exception would turn an already successful turn into a failure.
						 */
						try {
							session.maintain?.();
						} catch {
							// Maintenance problems are not this turn's concern. The user is already reading their
							// answer.
						}
					}
				}
			} catch (thrown) {
				/**
				 * The final save failed (quota exceeded, or the connection closed in between). If this simply
				 * threw, the cleanup below would not run. generatingRef would stay set, and no input would
				 * start in that conversation afterward, so the input would look dead to the user.
				 */
				end = "failed";
				/**
				 * The response arrived but could not be written to the device. The thrown value is not carried
				 * through, because it is a Dexie exception. In the screen's wording table an unnamed failure
				 * folds into 'could not get a response', which would be false.
				 */
				failure = new ChatPersistenceError({ cause: thrown });
			} finally {
				/**
				 * Lifecycle cleanup runs no matter what: provider success or failure, a broken stream, an
				 * abort, a local save failure, unmount, or an account switch. The symptom this block fixes is
				 * the locked input box that appeared when this was not a finally.
				 */
				generatingRef.current = false;
				// If the next generation has already put its own controller in place, this does not clear that
				// one either.
				abortRef.current = releaseOwnSlot(abortRef.current, controller);
				if (ownerRef.current?.controller === controller)
					ownerRef.current = null;
				cancelFlush();
				bufferRef.current = "";

				if (mountedRef.current) {
					// The confirmed message is now drawn by the conversation. The temporary text must be cleared,
					// or the same text appears twice.
					setStreamingText("");
					setGenerating(false);
					/**
					 * The 'turn awaiting an answer' verdict is decided by one pure function. It filters out turns
					 * that were saved, and also attempts whose user utterance was never saved.
					 */
					setUnanswered(
						awaitsAnswer({ userTurnCommitted, assistantSaved: saved }),
					);
					setStopped(end === "stopped");
					// Stop is not an error. A failure message is not attached to something the user ended
					// themselves.
					setError(end === "failed" ? failure : null);
				}
			}
		},
		[
			session,
			debug,
			preferences,
			providers,
			credentials,
			viewerId,
			viewer,
			client,
			/**
			 * The catalog is captured as two values. Capturing the whole query object would recreate this
			 * callback every time fetchStatus changes, and the reference held by an in-flight generation
			 * would change each time.
			 */
			catalog.data,
			catalog.isSuccess,
			scheduleFlush,
			cancelFlush,
		],
	);

	/**
	 * Starts a run and holds its promise in a line. Every start goes through this one line.
	 *
	 * Leaving `void run(...)` alone would leave rewriteHistory below with nothing to wait on.
	 */
	const start = useCallback(
		(
			text: string,
			allowEmpty: boolean,
			options?: ConversationSendOptions,
			continueId?: string,
		) => {
			settleRef.current = run(text, allowEmpty, options, continueId);
		},
		[run],
	);

	/**
	 * Walks back the outcome of the previous turn when a rewrite finishes without a follow-up
	 * generation.
	 *
	 * error, unanswered and stopped are facts about the last turn, and the rewrite has deleted that
	 * turn or rewritten what comes before it. For a while these three were cleared only when the next
	 * generation started. So after 'delete from here' or editing an assistant message, the old failure
	 * sentence and `Regenerate` still appeared. That button attached another answer to a
	 * conversation that already had one, and on managed generation that is billed.
	 *
	 * If a generation is still in flight, its finally rewrites its own outcome (stopped), so the
	 * clearing comes after that. The thing awaited is the promise queued when the rewrite began. If a
	 * new generation started since (the queue changed), or another rewrite bumped the epoch, that
	 * turn's outcome belongs to them and is left alone. The dialog is not tied to this wait, because
	 * the commit has already finished.
	 */
	const clearSettledTurn = useCallback((epoch: number) => {
		const pending = settleRef.current;
		void pending
			.catch(() => undefined)
			.then(() => {
				if (
					!mountedRef.current ||
					settleRef.current !== pending ||
					epoch !== historyEpochRef.current ||
					generatingRef.current
				)
					return;
				setError(null);
				setUnanswered(false);
				setStopped(false);
			});
	}, []);

	const rewriteHistory = useCallback(
		async <T>(
			perform: () => Promise<T>,
			options: { regenerate?: (result: T) => boolean } = {},
		): Promise<T> => {
			/**
			 * Bump the epoch first, then abort. This order is the whole function.
			 *
			 * If the epoch were bumped after the rewrite commits, a generation that finished in between
			 * would attach its answer to the old history. The rewrite transaction, whose range was already
			 * decided, would commit without seeing it, leaving an orphaned answer under the deleted
			 * conversation. Bumping first means the worst case loses only the partial text of the response
			 * in progress, which is exactly what the user just asked to delete.
			 *
			 * Abort uses the existing path (abortRef). Creating a new controller here would let the stop
			 * button and this action cut different generations.
			 */
			const epoch = ++historyEpochRef.current;
			abortRef.current?.abort();

			/**
			 * The commit does not wait for the network. The dialog closes as soon as the storage transaction
			 * ends. The cleanup of the in-flight generation finishes afterward on its own, since it could
			 * not write anyway.
			 */
			const result = await perform();

			if (!options.regenerate?.(result)) {
				clearSettledTurn(epoch);
				return result;
			}
			/**
			 * A follow-up generation starts by queuing. If the stopped generation has not yet reached its
			 * finally, canStartGeneration silently rejects the new request, and the user sees no effect.
			 */
			await settleRef.current.catch(() => undefined);
			/**
			 * Does not start if the user left the screen or started another rewrite while waiting. A
			 * generation started on a screen the user has left is a response nobody will see. A later
			 * rewrite has already rewritten the history this generation would have used.
			 */
			if (mountedRef.current && epoch === historyEpochRef.current)
				start("", true);
			return result;
		},
		[start, clearSettledTurn],
	);

	return {
		streamingText,
		generating,
		error,
		unanswered,
		stopped,
		send: useCallback(
			(text: string, options?: ConversationSendOptions) =>
				start(text, false, options),
			[start],
		),
		regenerate: useCallback(() => start("", true), [start]),
		advance: useCallback(() => start("", true), [start]),
		continueGeneration: useCallback(
			(messageId: string) => start("", true, undefined, messageId),
			[start],
		),
		canContinue: Boolean(session?.extendAssistantMessage),
		stop: useCallback(() => abortRef.current?.abort(), []),
		rewriteHistory,
	};
}
