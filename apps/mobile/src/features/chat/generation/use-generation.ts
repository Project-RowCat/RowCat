import {
	type ConversationDebugSink,
	type ConversationSession,
	type ConversationSessionKey,
	canPersistGeneration,
	canStartGeneration,
	chatConversationTools,
	type GenerationOwner,
	type GenerationTarget,
	ownsSession,
	promptPackCapabilityFor,
	reasoningCapabilityFor,
	releaseOwnSlot,
} from "@rowcat/chat";
import {
	generationModelsQueryOptions,
	viewerQueryOptions,
} from "@rowcat/query";
import { useQuery } from "@tanstack/react-query";
import { useIsFocused } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { getRowCatClient } from "../../../lib/api.ts";
import { nativeStreamingFetch } from "../../../lib/generation/native-fetch.ts";
import { streamChatGenerationPlan } from "../../../lib/generation/transport.ts";
import { useHapticCue } from "../../../lib/haptics/index.ts";
import {
	useGenerationScope,
	useProviderCredentialScope,
	useProviderScope,
} from "../../../lib/local-data/scope.tsx";
import { signalsGenerationDone } from "./completion-haptic.ts";
import { runGenerationTurn } from "./turn.ts";

/**
 * The React wiring of the generation lifecycle; no product rules live here.
 *
 * Ordering and failure handling belong to `generation-turn.ts` (pure), the save decision to
 * `resolveGenerationOutcome` and ownership to `canPersistGeneration` (both `@rowcat/chat`). This
 * file holds only what those cannot: state, refs, the abort handle, mount lifetime and frame
 * coalescing. They are split because mobile tests do not render screens (`vitest.config.ts`), and
 * mistakes here are silent (a signed-out account's response saved, a stopped response attaching
 * late).
 *
 * There is no provider branching in this hook: BYO only swaps the transport that
 * `generation-turn.ts` calls. An `if (provider === …)` here would let the two paths' safety rules
 * diverge.
 */

export interface ChatSendOptions {
	/**
	 * Called once after the user utterance is saved to the conversation; the composer's signal to
	 * clear itself. What `send()` returns is not "the response finished"; folding the two into one
	 * signal would make the composer hold the user's sentence until the model answers and later wipe
	 * whatever the user started typing next.
	 */
	onAccepted?: () => void;
}

export interface ChatGenerationState {
	/** Streaming assistant text; lives only here until it is confirmed. */
	streamingText: string;
	generating: boolean;
	/** The last failure; cleared when the next attempt starts. */
	error: Error | null;
	/** The last user turn got no answer; the basis for showing `Regenerate`. */
	unanswered: boolean;
	/**
	 * Whether the user ended the last turn themselves (stop). Meaningful only paired with
	 * `unanswered`: it separates a breakage from the user cutting it, which the failure ladder decides
	 * (`generationRecovery`).
	 */
	stopped: boolean;
	send: (text: string, options?: ChatSendOptions) => void;
	/** Regenerates the last unanswered turn (no input). */
	regenerate: () => void;
	/**
	 * Writes the next scene after the last complete response without my input, the action behind the
	 * bottom scroll gesture (`advance` of `scrollAdvanceAction`). It takes the same path as
	 * `regenerate` (a turn with no input): when the history ends on an assistant message the assembler
	 * adds a nudge to continue, and the response stands as a new bubble. A separate name because the
	 * meaning differs: regenerate answers an unanswered turn, this advances an answered conversation
	 * by one scene. Target judgment is the screen's.
	 */
	advance: () => void;
	/**
	 * Continues the last response cut by the output cap in the same bubble. Unlike `regenerate`
	 * (another answer on the same history) it writes on from the exact character where the sentence
	 * was cut (prefill), deletes nothing, and so does not pass `rewriteHistory`. The target judgment
	 * (the last message's open tail) is the screen's, via the shared rule `continuationTarget`, same
	 * table as web.
	 */
	continueGeneration: (messageId: string) => void;
	stop: () => void;
	/**
	 * The only path that rewrites history (edit, regenerate, delete-from-here). Screens do not call
	 * `store.deleteFromMessage()` directly because of ordering: cut the running generation and commit
	 * after raising the epoch, so a late response does not attach where the deleted span was. Web's
	 * `useConversationGeneration` has the same name and order.
	 */
	rewriteHistory: <T>(
		perform: () => Promise<T>,
		options?: {
			/**
			 * Decides from the commit result whether to generate next. A predicate, not a boolean, because
			 * the rewrite may have done nothing (the anchor vanished meanwhile); generating then would
			 * attach an answer to an edit the user effectively cancelled.
			 */
			regenerate?: (result: T) => boolean;
		},
	) => Promise<T>;
}

/** Optional arguments; today only observation. Omitted, neither this file nor the pure turn runs differently from before instrumentation. */
export interface ChatGenerationOptions {
	/**
	 * Observation sink; only the story test passes it, product conversations do not. Same interface as
	 * web's `useConversationGeneration`, so the two apps' inspectors draw the same facts.
	 */
	debug?: ConversationDebugSink | null;
}

export function useChatGeneration(
	session: ConversationSession | null,
	/** The scope's owner, one axis of the ownership decision; `null` for guests or mid-switch. */
	viewerId: string | null,
	options: ChatGenerationOptions = {},
): ChatGenerationState {
	/**
	 * The sink is captured by the callback as the render's value (not frozen in a ref), same reason as
	 * web: its identity is the playback session's identity, so when the session changes an in-flight
	 * generation keeps the old sink and its late signals never reach the new record.
	 */
	const debug = options.debug ?? null;
	const client = getRowCatClient();
	const viewer = useQuery(viewerQueryOptions(client)).data ?? null;
	/**
	 * Where the global generation preference is read: a store reference, not a subscription. Holding a
	 * subscribed value in state would make which settings a request used depend on render timing, so
	 * the pure turn reads it at start (`generation-turn.ts`); this only passes the reference.
	 */
	const { store: preferences } = useGenerationScope();
	/**
	 * Provider connections are read straight from the store, same reason as preferences. A
	 * subscription leaves a window where a connection just removed in settings has not arrived, and a
	 * request started in it expects a credential that no longer exists.
	 */
	const { store: providers } = useProviderScope();
	/**
	 * The credential-opening port. This hook never sees plaintext: it hands the port to the router,
	 * and the secret is opened only at the moment the adapter is called (`withCredential` in
	 * `lib/local-provider/store.ts`).
	 */
	const { store: credentials } = useProviderCredentialScope();
	/**
	 * The catalogue, used only to check reasoning capability, not passed to availability
	 * (`resolveGenerationExecution`); there, a catalogue that failed to load would block a
	 * conversation, and a truly missing model is rejected by the provider.
	 *
	 * It is needed here because BYO has no server re-check, so this device is the last place to
	 * confirm the model has that step. Unverified means no parameter is sent; managed is correct
	 * either way because the server normalizes (the asymmetry lives in `reasoningEffortForRequest`).
	 * The query key is the same as the settings screen's (no extra request), and it never blocks
	 * generation: not arrived just means capability unknown.
	 */
	const catalog = useQuery(generationModelsQueryOptions(client));

	const [streamingText, setStreamingText] = useState("");
	const [generating, setGenerating] = useState(false);
	const [error, setError] = useState<Error | null>(null);
	const [unanswered, setUnanswered] = useState(false);
	/** Whether the last turn ended by stop; written once, at the same place as `unanswered`. */
	const [stopped, setStopped] = useState(false);

	const abortRef = useRef<AbortController | null>(null);
	/**
	 * Synchronous copy of "in progress". `generating` state alone is not enough: `setState` lands on
	 * the next render, so two requests in the same tick (rapid sends) both see `false` and pass,
	 * saving two responses for one turn and skewing that conversation from then on. A ref is visible
	 * on assignment, so that window does not exist.
	 */
	const generatingRef = useRef(false);
	/** Accumulated raw text; collects independently of screen updates (frame coalescing reads it). */
	const bufferRef = useRef("");
	const frameRef = useRef<number | null>(null);
	/** Blocks setState after unmount. Saving continues; that has nothing to do with the screen. */
	const mountedRef = useRef(true);

	/**
	 * Tells the hand that it finished; `signalsGenerationDone` decides whether to fire and this is
	 * wiring only. Focus is held in a ref: a conversation pushed back in the stack stays mounted, so
	 * `mountedRef` cannot answer "is it being looked at", and a value captured at start is not the
	 * fact at finish.
	 */
	const playGenerationDone = useHapticCue("generationDone");
	const focused = useIsFocused();
	const focusedRef = useRef(focused);
	useEffect(() => {
		focusedRef.current = focused;
	}, [focused]);

	/**
	 * Owner of the running generation and its abort handle. Kept apart from `abortRef`, which is "the
	 * stop the user presses", while this is "which conversation this generation belongs to"; merged,
	 * the ownership decision would be tied to the stop button's lifetime.
	 */
	const ownerRef = useRef<
		(GenerationOwner & { controller: AbortController }) | null
	>(null);
	/**
	 * The latest identity of the open conversation; a value captured in the start closure cannot be
	 * used for the check right before the confirming save.
	 */
	const keyRef = useRef<ConversationSessionKey>({
		viewerId,
		session: session?.token ?? null,
	});
	/**
	 * The history epoch. A tail rewrite (edit, regenerate, delete-from-here) raises it, so a
	 * generation started before that action, however it ends, has a different epoch and never reaches
	 * the save. Abort alone is not enough: it is only a signal, and a request that already received
	 * its whole body can finish as a success.
	 */
	const historyEpochRef = useRef(0);
	/**
	 * Whether the running generation has finished cleaning up. A continuation queuing behind needs it:
	 * if a cut generation has not reached `finally`, `canStartGeneration` quietly refuses the new
	 * request and the user sees nothing happen.
	 */
	const settleRef = useRef<Promise<unknown>>(Promise.resolve());

	/**
	 * Coalesces screen updates per frame. Providers send token-sized deltas dozens of times a second;
	 * a `setState` each would render that many times and make even typing sluggish on low-end Android.
	 * The screen draws once a frame anyway, so folding to that cadence looks the same with fewer
	 * renders. The final text stays exact: only the intermediate display is folded, and the saved
	 * value is the raw text the pure turn accumulated itself.
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
	 * Cuts the running generation when leaving the screen. Otherwise the model keeps generating (we
	 * pay for those tokens) and the connection stays open. On abort the pure turn's confirm block runs
	 * and saves the partial response already received; leaving the screen does not discard what the
	 * user was reading.
	 *
	 * Backgrounding is not this path: the screen stays mounted, so the stream stays alive, and if the
	 * platform or network cuts it it is handled as an ordinary interrupted generation. No background
	 * generation service is built.
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
	 * Cuts the running generation when the conversation's owner changes (sign-out, account switch).
	 * Otherwise Alice's generation would keep running in Bob's session and finish after Alice's
	 * database is already closed. The previous conversation is not reopened to save the partial
	 * response: identity isolation outranks partial-response preservation. Compared by the two values
	 * inside the key (`ownsSession`), not by object reference; cutting a healthy generation because a
	 * render built a new object would be a bug.
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

	const start = useCallback(
		async (
			text: string,
			allowEmpty: boolean,
			options?: ChatSendOptions,
			continueId?: string,
		) => {
			if (!session) return;
			if (
				!canStartGeneration({
					text,
					// Read the synchronous copy, not rendered state: it blocks a second call in the same tick.
					generating: generatingRef.current,
					ready: true,
					allowEmpty,
				})
			)
				return;

			generatingRef.current = true;
			const controller = new AbortController();
			abortRef.current = controller;
			/**
			 * Ownership is fixed here. If scope changes later, this generation still writes to the
			 * conversation it started in, and writes nothing once that conversation is no longer active.
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

			/** Start of the wait measurement; a short response raises no haptic. */
			const startedAt = Date.now();

			try {
				const result = await runGenerationTurn({
					session,
					text,
					allowEmpty,
					continueMessageId: continueId,
					viewer,
					preferences,
					/**
					 * Read once at start. A failed read is an empty list, so a BYO target is blocked and managed
					 * still runs, the direction with no silent substitution.
					 */
					loadConnectedProviders: async () =>
						(await providers?.list())?.map(
							(connection) => connection.provider,
						) ?? [],
					reasoningCapability: (target: GenerationTarget) =>
						reasoningCapabilityFor({
							models: catalog.data ?? [],
							catalogLoaded: catalog.isSuccess,
							target,
						}),
					/** Same snapshot as above, so the two capabilities never see different catalogues. */
					promptPackCapability: (target: GenerationTarget) =>
						promptPackCapabilityFor({
							models: catalog.data ?? [],
							catalogLoaded: catalog.isSuccess,
							target,
						}),
					signal: controller.signal,
					streamPlan: (plan, target, options) =>
						streamChatGenerationPlan(
							plan,
							target,
							{
								client,
								credentials,
								fetch: nativeStreamingFetch,
								/**
								 * What this conversation may call. One place builds the list (`chatConversationTools`) and
								 * the app only passes it; if each app built its own, the same story would have different
								 * tools per device, showing up as response quality rather than an error. Tools that do not
								 * stand are not in the array, so a room with no lore to find sends a request byte-identical
								 * to before this axis.
								 */
								toolAccess: {
									tools: chatConversationTools(session.runtime),
									/**
									 * A generation that can no longer be saved makes no more round trips either. The same
									 * predicate as the confirming save; the results differ but the axis is the same, and
									 * splitting them would keep round trips going after leaving the room.
									 */
									isValid: () =>
										canPersistGeneration(
											owner,
											keyRef.current,
											historyEpochRef.current,
										),
								},
							},
							options,
						),
					/**
					 * The check right before the confirming save, over both axes: conversation identity alone
					 * would attach an answer to a conversation just deleted, and history alone would send a
					 * signed-out account's response into the next person's database.
					 */
					canPersist: () =>
						canPersistGeneration(
							owner,
							keyRef.current,
							historyEpochRef.current,
						),
					onText: (accumulated) => {
						bufferRef.current = accumulated;
						scheduleFlush();
					},
					onAccepted: options?.onAccepted,
					debug,
				});

				if (mountedRef.current) {
					setUnanswered(result.unanswered);
					setStopped(result.end === "stopped");
					setError(result.failure);
					/**
					 * Fires after the state is applied; state does not wait for the haptic, and the return value
					 * is not awaited either: a missed haptic is not a loss for the user.
					 */
					if (
						signalsGenerationDone({
							end: result.end,
							saved: result.saved,
							startedAt,
							endedAt: Date.now(),
							focused: focusedRef.current,
							foreground: AppState.currentState === "active",
						})
					)
						playGenerationDone();
				}
			} finally {
				/**
				 * Lifecycle cleanup runs no matter what. If this were not a `finally`, `generatingRef` would
				 * stay on and no later input in that conversation would start, which the user sees as a dead
				 * composer.
				 */
				generatingRef.current = false;
				// Do not clear a controller the next generation already put in.
				abortRef.current = releaseOwnSlot(abortRef.current, controller);
				if (ownerRef.current?.controller === controller)
					ownerRef.current = null;
				cancelFlush();
				bufferRef.current = "";
				if (mountedRef.current) {
					// The confirmed message is now drawn by the subscription; clear the temporary text to avoid a
					// double.
					setStreamingText("");
					setGenerating(false);
				}
			}
		},
		[
			session,
			debug,
			viewerId,
			viewer,
			preferences,
			providers,
			credentials,
			catalog.data,
			catalog.isSuccess,
			client,
			scheduleFlush,
			cancelFlush,
			playGenerationDone,
		],
	);

	/**
	 * Holds the start in an awaitable form. Letting it go as `void start(...)` would leave
	 * `rewriteHistory` below with nothing to wait on.
	 */
	const begin = useCallback(
		(
			text: string,
			allowEmpty: boolean,
			options?: ChatSendOptions,
			continueId?: string,
		) => {
			settleRef.current = start(text, allowEmpty, options, continueId);
		},
		[start],
	);

	/**
	 * Clears the previous turn's outcome when a rewrite ends without a follow-up generation (same rule
	 * as web). `error`, `unanswered` and `stopped` are facts about the last turn, which the rewrite
	 * deleted or rewrote before. They used to clear only when the next generation started, so after
	 * delete-from-here or an assistant edit the old failure sentence and `Regenerate` stayed, and that
	 * button added another answer to an already answered conversation (billed on managed).
	 *
	 * A cut generation still pending rewrites the outcome (stop) in its own cleanup, so clearing comes
	 * after it. If a new generation started meanwhile (the queue changed) or another rewrite raised
	 * the epoch, that turn's outcome belongs to them and is left alone. The sheet is not tied to this
	 * wait.
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
			 * Raise the epoch first, then cut. The order is the whole function. Raised after the commit, a
			 * generation finishing in between would attach an answer to the old history while the rewrite
			 * transaction (its range already fixed) commits without seeing it, leaving an orphan answer
			 * under the deleted conversation. Raised early, the worst loss is the partial text of the
			 * in-flight response, which is the span the user just said to delete. The abort uses the
			 * existing path (`abortRef`); a new controller here would make the stop button and this action
			 * cut different generations.
			 */
			const epoch = ++historyEpochRef.current;
			abortRef.current?.abort();

			/**
			 * The commit does not wait on the network. The sheet closes as soon as the store transaction
			 * ends, and the in-flight generation's cleanup finishes afterwards (it cannot write anyway).
			 */
			const result = await perform();

			if (!options.regenerate?.(result)) {
				clearSettledTurn(epoch);
				return result;
			}
			await settleRef.current.catch(() => undefined);
			/**
			 * Do not start if the screen was left during the wait or another rewrite happened: a generation
			 * started on a left screen is a response nobody sees, and the later rewrite already rewrote the
			 * history this one would be based on.
			 */
			if (mountedRef.current && epoch === historyEpochRef.current)
				begin("", true);
			return result;
		},
		[begin, clearSettledTurn],
	);

	return {
		streamingText,
		generating,
		error,
		unanswered,
		stopped,
		send: useCallback(
			(text: string, options?: ChatSendOptions) => {
				begin(text, false, options);
			},
			[begin],
		),
		regenerate: useCallback(() => {
			begin("", true);
		}, [begin]),
		advance: useCallback(() => {
			begin("", true);
		}, [begin]),
		continueGeneration: useCallback(
			(messageId: string) => {
				begin("", true, undefined, messageId);
			},
			[begin],
		),
		stop: useCallback(() => abortRef.current?.abort(), []),
		rewriteHistory,
	};
}
