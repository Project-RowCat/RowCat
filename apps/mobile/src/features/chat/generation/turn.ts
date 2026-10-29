import {
	awaitsAnswer,
	type ChatGenerationEnd,
	type ChatGenerationPlan,
	type ChatGenerationUsage,
	type ConversationDebugSignal,
	type ConversationDebugSink,
	type ConversationSession,
	commitUserTurn,
	type GenerationPreferenceStore,
	type GenerationProvider,
	type GenerationTarget,
	isManagedTarget,
	narrationInjection,
	type PromptPackCapabilityLookup,
	planChatGeneration,
	type ReasoningCapabilityLookup,
	reasoningEffortForRequest,
	resolveAllAges,
	resolveEffectiveGeneration,
	resolveGenerationExecution,
	resolveGenerationOutcome,
	resolveNarrationExecution,
	safeChatRequestDebug,
} from "@rowcat/chat";
import type { ChatStreamEvent } from "@rowcat/contracts";
import {
	canUseByoProvider,
	canViewAdultContent,
	type Viewer,
} from "@rowcat/domain";
import { ensurePromptPack } from "@rowcat/prompt-packs";
import { safeGenerationFailure } from "./debug.ts";
import {
	ChatGenerationBlockedError,
	ChatPersistenceError,
	ChatStreamFailure,
} from "./error.ts";

/**
 * One generation turn: ordering and failure handling, with no React.
 *
 * Split from the hook because mobile tests do not render screens (`vitest.config.ts`). The rules
 * here are the kind that compile when violated and fail silently on device (a request built from an
 * unsaved utterance, a signed-out account's response saved, a stopped response attaching late), so
 * they must be testable without "try it by hand" (same split as `activation.ts` ↔ `scope.tsx`).
 *
 * ```text
 * 1. save the user message to the conversation   ← before the network
 * 2. assemble context from the stored messages   (@rowcat/chat: buildChatGenerationRequest)
 * 3. resolve the target and start the stream on its transport
 * 4. arriving text only flows to the caller (never saved)
 * 5. on finish, save the assistant message once  (@rowcat/chat: resolveGenerationOutcome)
 * ```
 *
 * Step 1 comes first because the user already sent it: it must survive a dropped network or a dead
 * app, and step 2's context must equal what is stored or the next turn's history diverges. If that
 * commit fails it throws and step 3 is never reached, so no request can go out on an unsaved
 * utterance.
 *
 * Step 4 does not save because per-token SQLite writes would mean hundreds of transactions per
 * response, and intermediate state is not product data.
 *
 * Step 5 writes only while the conversation is unchanged since the start (`canPersist`). The
 * predicate is injected because ownership lives in a React ref, while when to ask is the same
 * everywhere.
 */

export interface GenerationTurnInput {
	session: ConversationSession;
	/** The composer's raw text; `Regenerate` passes an empty string plus `allowEmpty`. */
	text: string;
	/** Starts without input (regenerate); that utterance is already in the history. */
	allowEmpty: boolean;
	/**
	 * Id of the message to continue; when set the turn is a continuation: no user utterance is
	 * attached, the request is assembled with a prefill (`continuation`), and the commit extends
	 * instead of appending (same table as web's `use-conversation-generation.ts`). Does nothing if the
	 * session cannot extend.
	 */
	continueMessageId?: string | undefined;
	/** This account's entitlement; the adult gate and BYO permission come from here. */
	viewer: Viewer | null;
	/**
	 * Reads this device's global generation preference, the layer above the room override.
	 *
	 * It arrives here, not on the session, because ownership differs: the room override belongs to the
	 * conversation (`ConversationSession.loadPreference`), the global to the device. On the session
	 * port the story test would have to answer it and a non-persisting session would know the device
	 * store. `null` means that layer is empty (scope not open yet, or a guest), so the product default
	 * applies as before this feature.
	 */
	preferences: GenerationPreferenceStore | null;
	/**
	 * Providers this device currently holds credentials for, read once when the turn starts.
	 *
	 * A function, not a value: a value would belong to the render that built the hook, and a button
	 * pressed later would judge by a stale list (a just-connected provider shown as not connected).
	 *
	 * No secret comes here. This port only answers "can that provider run"; the transport opens the
	 * actual key at its own moment, which is why the pure turn never holds plaintext credentials. A
	 * failed read falls to an empty list, the safe direction: BYO is blocked, managed still runs.
	 */
	loadConnectedProviders: () => Promise<readonly GenerationProvider[]>;
	/**
	 * Reasoning capability of this target, answered by the model catalogue snapshot.
	 *
	 * BYO has no server re-check, so this device is the last place to verify the model has that step.
	 * When it cannot be verified (`undefined`) the shared function splits by path: managed sends as is
	 * (the server normalizes), BYO omits (`reasoningEffortForRequest`). Not a gate on generation: a
	 * missing catalogue must not block a conversation.
	 */
	reasoningCapability: (target: GenerationTarget) => ReasoningCapabilityLookup;
	/**
	 * Prompt-pack capability of this target, same nature and source as reasoning above.
	 *
	 * A callback because the catalogue lives in a screen query and this file knows no React. Not found
	 * (`undefined`) differs from no capability (`null`); on the former no pack is set up, since
	 * guessing would make the room run a different pack on this device only. Not a gate: with no pack
	 * the request is what it was before this axis existed.
	 */
	promptPackCapability: (
		target: GenerationTarget,
	) => PromptPackCapabilityLookup;
	signal: AbortSignal;
	/**
	 * Sends one assembly plan to an executable target; availability was already judged.
	 *
	 * Device assembly goes through that target's transport (tool loop included), a protected story's
	 * server assembly through its own path (`streamChatGenerationPlan`). That fork is deliberately
	 * absent here; web's hook calls the same function in the same place.
	 */
	streamPlan: (
		plan: ChatGenerationPlan,
		target: GenerationTarget,
		options: { signal: AbortSignal },
	) => AsyncIterable<ChatStreamEvent>;
	/**
	 * Whether the confirming save is allowed, asked right before the irreversible write. Synchronous
	 * on purpose: awaiting during the decision would make the decision itself stale.
	 */
	canPersist: () => boolean;
	/** Accumulated response text, called per delta; coalescing screen updates is the caller's job. */
	onText: (text: string) => void;
	/** Called once after the user utterance is saved; the signal for the composer to clear itself. */
	onAccepted?: (() => void) | undefined;
	/**
	 * Observation sink; without one nothing happens. Product conversations (local rooms) do not pass
	 * it, only the story test does, and its record lives in memory until the session ends
	 * (`debug-trace.ts` in `@rowcat/chat`). Same model as web, so one app cannot drift into not
	 * recording a turn that lost ownership.
	 */
	debug?: ConversationDebugSink | null | undefined;
}

export interface GenerationTurnResult {
	end: ChatGenerationEnd;
	/** User-visible failure. A stop never arrives here; the user's own stop gets no failure copy. */
	failure: Error | null;
	/** Whether the last user turn remains unanswered; the basis for showing `Regenerate`. */
	unanswered: boolean;
	/** Whether the confirmed response was actually saved. */
	saved: boolean;
}

export async function runGenerationTurn(
	input: GenerationTurnInput,
): Promise<GenerationTurnResult> {
	const { session, signal } = input;

	/**
	 * Starts as `failed` on purpose: `completed` would record every path that did not confirm a normal
	 * end as a normal completion. The only evidence of completion is the `done` event, and the value
	 * is raised below only when it is received (the SDK enforces the protocol-level twin: a stream
	 * ending without a terminal event surfaces as an error).
	 */
	const continuing = input.continueMessageId !== undefined;
	// Do not start where the conversation cannot append (the story test: no record to extend).
	if (continuing && !session.extendAssistantMessage)
		return {
			end: "failed",
			failure: null,
			unanswered: false,
			saved: false,
		};

	const debug = input.debug ?? null;
	/**
	 * This turn's observation identity, issued after the start is confirmed (after the rejection
	 * above); issued earlier, a turn that never started would sit in the record as `running` forever.
	 */
	const turnId =
		debug?.beginTurn(
			continuing ? "continue" : input.allowEmpty ? "regenerate" : "send",
		) ?? null;
	/** With instrumentation off no signal is even built, hence the function argument. */
	const note = (build: (turnId: string) => ConversationDebugSignal): void => {
		if (debug && turnId !== null) debug.emit(build(turnId));
	};

	let end: ChatGenerationEnd = "failed";
	let failure: Error | null = null;
	let usage: ChatGenerationUsage | undefined;
	/** The provider's raw reason carried by `done`; normalized by `@rowcat/chat` (continuation.ts). */
	let finishReason: string | undefined;
	let saved = false;
	/**
	 * Regenerate starts true: that turn's utterance is already in the history. A continuation starts
	 * false and stays false: marking its failure as an awaiting turn would show `Regenerate`, which appends
	 * a new bubble after the cut response. On failure `truncated` stays, so `Continue generating` returns, which is
	 * the right retry.
	 */
	let userTurnCommitted = continuing ? false : input.allowEmpty;
	/**
	 * Whether a request actually went out to the provider, the basis for recording the round trip's
	 * end. Without it a turn whose utterance failed to save would leave "the response ended" on the
	 * timeline; a failed round trip and one that never happened call for different user actions.
	 */
	let requested = false;
	let buffer = "";

	try {
		/**
		 * 1. Save the user message first; the room's activity time rises in the same transaction. The
		 *    composer clears here too: `onAccepted` fires only after this commit succeeds.
		 */
		let committed: boolean;
		try {
			committed = await commitUserTurn({
				session,
				text: input.text,
				onAccepted: input.onAccepted,
			});
		} catch (thrown) {
			/**
			 * The utterance failed to save, so this turn did not happen. Record and rethrow (caught below);
			 * swallowing would let a request go out on an unsaved utterance, which this ordering exists to
			 * make impossible.
			 */
			note((id) => ({
				kind: "input-rejected",
				turnId: id,
				data: { reason: thrown instanceof Error ? thrown.name : "unknown" },
			}));
			throw thrown;
		}
		if (committed) {
			userTurnCommitted = true;
			note((id) => ({
				kind: "input-accepted",
				turnId: id,
				data: { characters: input.text.trim().length },
			}));
		}

		/**
		 * 2. Re-read what was stored to build the context. The just-written value is not appended from
		 *    memory because the conversation's order is the next turn's history.
		 */
		const history = await session.loadHistory();
		/**
		 * Precondition of a continuation: the history still ends with an assistant message. If the
		 * conversation moved on, quietly stop (same decision as web); proceeding would be an ordinary
		 * generation with a nudge, attached to the truncated message.
		 */
		if (continuing && history[history.length - 1]?.role !== "assistant") {
			note((id) => ({
				kind: "turn-discarded",
				turnId: id,
				data: { reason: "precondition" },
			}));
			return {
				end: "failed",
				failure: null,
				unanswered: false,
				saved: false,
			};
		}
		/** Memory is read once and frozen; edits while the response streams do not change this request. */
		const memories = await session.loadMemories();
		/**
		 * Characters added to this conversation, frozen at the same moment as memory: adding one while
		 * the response streams leaves this request on the starting cast, and the next turn reads the new
		 * one.
		 */
		const characters = await session.loadCharacters();
		/**
		 * The summary is a snapshot at the same moment too. Background maintenance may update it while
		 * the response streams, and picking up the new one mid-request would make which context a request
		 * used depend on another task's timing.
		 */
		const summary = await session.loadSummary();
		/**
		 * Secures this conversation's routing-affinity key; some conversations have none (playback
		 * sessions). Unlike the three above this is acquisition, not a snapshot: the value lives on the
		 * room record and never changes once set, but a room built under an older version gets one issued
		 * and stored here (web does the same at the same place).
		 */
		const routingSessionId = (await session.loadRoutingSessionId?.()) ?? null;

		/**
		 * Freezes this turn's effective generation settings: room > global > product default. Reading
		 * once into a local is the whole snapshot: a setting changed mid-response applies to the next
		 * request, and an in-flight generation is neither cut nor altered (web's
		 * `use-conversation-generation.ts` has the same shape). The precedence table is not imitated
		 * here; a second `room ?? global ?? default` would drift between the apps and show up only as
		 * "one room did not change".
		 */
		const effective = resolveEffectiveGeneration({
			global: await input.preferences?.getGlobal(),
			room: await session.loadPreference(),
		});

		/**
		 * Wanted target to executable target. The connection list is read once and frozen, so the request
		 * ends with the providers connected at the start; disconnecting mid-response does not cut it (an
		 * already-sent request is not cancelled retroactively).
		 *
		 * A BYO target with no connection is blocked here and never silently falls to managed, which
		 * would change the billed party and the server the prompt passes through with no visible sign.
		 * The catalogue is not passed: failing to read server state must not block a conversation, and a
		 * truly missing model is rejected by the provider.
		 */
		const execution = resolveGenerationExecution({
			target: effective.target,
			connectedProviders: await input.loadConnectedProviders(),
			byoAllowed: canUseByoProvider(input.viewer),
			/** A protected story's room runs only on RowCat-provided models; the server assembles the manuscript. */
			managedOnly: session.protectedStoryId !== undefined,
		});
		if (execution.status === "blocked")
			throw new ChatGenerationBlockedError(execution);

		/**
		 * The narration pack joins three pieces (same order as web):
		 *
		 * ```text
		 * what this conversation chose   session.loadNarration()    room record (synced)
		 * what this model supports       promptPackCapability()     server catalogue
		 * the actual body                ensurePromptPack()         lazy load
		 * ```
		 *
		 * Capability is read for `execution.target` (what actually runs this turn), not
		 * `effective.target` (what the user wanted); the latter yields a pack that disagrees with the
		 * model. If any piece disagrees the value folds to `null` and the prompt is byte-identical to
		 * before this axis; `narrationInjection` makes the state where only the protection sentence is
		 * missing unrepresentable.
		 */
		const narrationExecution = resolveNarrationExecution({
			settings: (await session.loadNarration?.()) ?? null,
			capability: input.promptPackCapability(execution.target),
		});
		const narration = narrationInjection(
			narrationExecution,
			narrationExecution
				? await ensurePromptPack(narrationExecution.packKey)
				: "",
		);

		/**
		 * The rating decision is the same function as web: story rating first, member entitlement on top,
		 * so mobile gets no looser adult gate (on the managed path the server re-decides from the
		 * session). It is a local because of observation: computing twice could split the rating the
		 * screen records from the one the prompt used.
		 */
		const allAges = resolveAllAges(session.runtime, {
			adultAllowed: canViewAdultContent(input.viewer),
		});
		/**
		 * Reasoning effort: the last capability check differs per path.
		 *
		 * ```text
		 * managed  the server re-decides from its registry → unverified is sent as is
		 * BYO      this device is the last check           → unverified is omitted
		 * ```
		 *
		 * That asymmetry is not rewritten here; the shared function decides from the target
		 * (`reasoningEffortForRequest`). This file only looks up the target's capability in the snapshot;
		 * not found differs from no capability.
		 */
		const reasoningEffort = reasoningEffortForRequest({
			target: execution.target,
			effort: effective.reasoningEffort,
			capability: input.reasoningCapability(execution.target),
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
			// A continuation ends in a prefill; a nudge would make the model start a new turn.
			...(continuing ? { continuation: true } : {}),
			/*
			 * Leaves the prompt untouched. With no key made, a conversation without this capability sends
			 * what it always did.
			 */
			...(routingSessionId ? { routingSessionId } : {}),
			/*
			 * No key when absent, so a conversation not using a pack is byte-identical to before this axis.
			 */
			...(narration ? { narration } : {}),
		};
		/**
		 * Decides where to assemble, once, with the same function as web (`planChatGeneration`). A
		 * protected story's room sends only this device's share of the assembly input to the server. With
		 * tracing on, a different view of the same assembler is used; both go through one implementation,
		 * so the outgoing request is identical either way.
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

		/** Records the running target, not the wanted one, same rule as web. */
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

		for await (const event of input.streamPlan(plan, execution.target, {
			signal,
		})) {
			if (event.type === "delta") {
				buffer += event.text;
				input.onText(buffer);
			} else if (event.type === "usage") {
				/**
				 * Axes the provider did not report get no key. Filling 0 would make "the cache did not hit at
				 * all" indistinguishable from "the provider did not say" in storage.
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
				 * A failure after the stream started. Stop here without throwing: already-received text must
				 * still be saved below. The code is carried intact because the user knows different things
				 * after a settlement failure than after a provider failure.
				 */
				failure = new ChatStreamFailure(event.code, event.message);
				break;
			} else if (event.type === "done") {
				// `done` was actually received: the only basis for recording completion.
				end = "completed";
				/**
				 * The finish reason comes only from here. Kept as the provider's raw string; the save rule
				 * decides truncation (`continuation.ts` in `@rowcat/chat`), so a screen branching on this
				 * string would leave this app ignorant of a new provider's vocabulary.
				 */
				finishReason = event.finishReason;
			}
		}
	} catch (thrown) {
		/**
		 * The user stopped, left the screen, or the account changed. An abort is an intended end, not a
		 * failure, so no error copy is shown, but the partial response is preserved as usual (if
		 * ownership holds). A failed user-utterance commit also lands here; `userTurnCommitted` is false
		 * then, so it does not become an awaiting turn because that turn did not happen.
		 */
		if (signal.aborted) end = "stopped";
		else failure = thrown instanceof Error ? thrown : new Error(String(thrown));
	}

	/**
	 * The provider round trip ended; recorded before the commit so "the response arrived but was not
	 * saved" reads on the timeline.
	 */
	if (requested)
		note((id) => ({
			kind: "provider-response",
			turnId: id,
			data: {
				end,
				outputCharacters: buffer.length,
				/** `null` when unreported; never filled with 0. */
				usage: usage ?? null,
				finishReason: finishReason ?? null,
			},
		}));
	if (failure) {
		const projected = safeGenerationFailure(failure);
		note((id) => ({ kind: "generation-failed", turnId: id, data: projected }));
	}

	/**
	 * 4. Commit. A pure function (`@rowcat/chat`) decides what to save for normal end, stop,
	 *    failure and partial failure, so the rules are not scattered across screens and this app
	 *    defines no table of its own. A continuation extends instead of appending; the merge rules
	 *    (text concatenation, usage sum, scene image, tracking cleanup) are kept by the store through
	 *    a shared function (`extendAssistantRecord`).
	 */
	const outcome = input.continueMessageId
		? { message: null, unanswered: false }
		: resolveGenerationOutcome({
				text: buffer,
				end,
				...(usage ? { usage } : {}),
				/**
				 * The finish reason is passed too, so a completion cut by the output cap stays `truncated` and
				 * grounds `Continue generating`.
				 */
				...(finishReason !== undefined ? { finishReason } : {}),
				/**
				 * Scene image attachment is done by that pure function as well, same rule and function as web;
				 * attaching the token here would give the same response different pictures per device.
				 */
				sceneImages: session.runtime.seed.sceneImages,
			});

	/**
	 * The decision is made once and the record and the save share it. Asking twice would let them
	 * diverge the day an `await` lands between: the inspector says not saved while the conversation
	 * holds the answer, the opposite of why this feature exists. `canPersist` is a predicate and may
	 * answer differently on each call.
	 */
	const hasBody = Boolean(buffer.trim());
	/** Nothing to save means it is not asked; the condition for calling the predicate is unchanged. */
	const savable = input.continueMessageId ? hasBody : outcome.message !== null;
	const persistable = savable ? input.canPersist() : false;

	if (input.continueMessageId) {
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
	}

	if (input.continueMessageId && hasBody && persistable) {
		try {
			await session.extendAssistantMessage?.(input.continueMessageId, {
				text: buffer,
				end,
				...(usage ? { usage } : {}),
				...(finishReason !== undefined ? { finishReason } : {}),
				sceneImages: session.runtime.seed.sceneImages,
			});
			saved = true;
			/** A continuation attaches to the existing row; no new identity appears. */
			note((id) => ({
				kind: "turn-committed",
				turnId: id,
				data: { messageId: input.continueMessageId ?? null },
			}));
			// Continued text is conversation growth too, the same trigger as an ordinary save.
			try {
				session.maintain?.();
			} catch {
				// Maintenance's own business; the user is already reading their answer.
			}
		} catch (thrown) {
			// The response arrived but could not be written to the device, same branch as the append path.
			end = "failed";
			failure = new ChatPersistenceError({ cause: thrown });
		}
	}

	/**
	 * If ownership moved on, do not write, even with something to save: this response belongs to an
	 * already signed-out account, and the identity/conversation boundary outranks one partial
	 * response.
	 */
	if (!input.continueMessageId) {
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
	}

	if (outcome.message && persistable) {
		try {
			/**
			 * The conversation answers the correspondence. If a screen guessed later that the last row
			 * belongs to the last turn, one late-finishing generation would break the guess.
			 */
			const messageId = await session.appendAssistantMessage(outcome.message);
			saved = true;
			note((id) => ({
				kind: "turn-committed",
				turnId: id,
				data: { messageId: messageId ?? null },
			}));
			/**
			 * Wake auto-maintenance after the save, without awaiting. Here because that is exactly when the
			 * message count changes (the trigger), and waking before the save would pick a batch over a
			 * history missing the response just made. Failure is unrelated to this turn: the port is
			 * supposed not to throw (`ConversationSession.maintain`), but an escaped exception would turn an
			 * already successful turn into a failure.
			 */
			try {
				session.maintain?.();
			} catch {
				// Maintenance's own business; the user is already reading their answer.
			}
		} catch (thrown) {
			/**
			 * The response arrived but could not be written to the device. Reported separately from network
			 * failure because the user's facts differ (it was read, yet is gone when reopened). It does not
			 * throw so the caller's cleanup needs no extra `finally`, whose omission would kill the
			 * composer.
			 */
			end = "failed";
			failure = new ChatPersistenceError({ cause: thrown });
		}
	}

	return {
		end,
		/** A stop is not an error; the user's own stop gets no failure copy. */
		failure: end === "failed" ? failure : null,
		/**
		 * One pure function decides "awaiting an answer". It also filters out an attempt whose user
		 * utterance was never saved: marking it awaiting would show `Regenerate`, which generates from the
		 * previous history.
		 */
		unanswered: awaitsAnswer({ userTurnCommitted, assistantSaved: saved }),
		saved,
	};
}
