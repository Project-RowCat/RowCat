import type { ChatGenerationEnd, ChatGenerationUsage } from "./generation.ts";
import type {
	GenerationTarget,
	ResponseLength,
} from "./generation-preference.ts";
import type { ChatPromptTrace, SafeChatRequestDebug } from "./prompt-trace.ts";
import type { ReasoningEffort } from "./reasoning.ts";

/**
 * One conversation turn's observation log. It runs alongside the execution path and does not drive
 * it.
 *
 * One rule: **with no sink, nothing happens.** The local room does not pass a sink, so the
 * generation lifecycle runs exactly as it did before this file existed.
 *
 * - Lives in memory, only while the screen that owns it is alive.
 * - Goes nowhere: not IndexedDB, SQLite, sync, a server or telemetry.
 * - Is discarded when the session object changes and when the screen is left.
 * - Growth is capped. Past the cap the oldest entries are dropped, and the drop itself is
 *   recorded.
 *
 * Why it lives in @rowcat/chat: every event here uses one turn's vocabulary (input accepted, lore
 * selected, prompt assembled, provider answered, turn committed). That vocabulary belongs next to
 * the rules that produce it. Per-app copies would diverge in one direction, for example one app
 * failing to record a turn whose ownership was lost.
 *
 * Runtime (creative code execution) events are not here. They belong to Studio preview, and mobile
 * has no Studio. Putting them in this package would make chat depend on the runtime. The envelope
 * and buffer are generic, so that branch can share the same structure.
 *
 * Why it is pure: there is no clock and no random source here. `id` and `at` come from outside (the
 * `now` passed to `createConversationDebugStore`), so the reducer can be checked by value: whether
 * the cap drops the oldest entries, whether a late turn stays off new turns, and whether
 * uncommitted values stay uncommitted.
 */

/**
 * The envelope of one event.
 *
 * There is deliberately no `kind` here. Each branch has its own discriminated union, and this shape
 * is intersected onto it. The screen branches on its own `kind`, so nothing has to recover the kind
 * by parsing the human-readable `summary`.
 */
export interface DebugEventEnvelope {
	/**
	 * Increases monotonically from 1. **Ordering is by this value, not by time**, since identical
	 * milliseconds are common.
	 */
	id: number;
	/** Epoch milliseconds. For display only, never the basis for ordering. */
	at: number;
	/** The turn this event belongs to. Events outside any turn (session operations) have `null`. */
	turnId: string | null;
	/** One-line summary, **for display only**. Code that branches on this string is a parser. */
	summary: string;
}

export interface DebugTraceLimits {
	/** Maximum number of events kept. Past it, the **oldest** events are dropped. */
	maxEvents: number;
	/** Maximum number of turn records kept. Past it, the oldest turns are dropped. */
	maxTurns: number;
	/** Maximum length of one stored string. Prompt blocks and messages are bounded by this. */
	maxTextLength: number;
}

export const DEFAULT_DEBUG_TRACE_LIMITS: DebugTraceLimits = Object.freeze({
	maxEvents: 500,
	maxTurns: 20,
	maxTextLength: 40_000,
});

/**
 * An event list. It carries the drop count **alongside** the entries, because silently dropping
 * would make the list misleading.
 */
export interface DebugEventLog<E extends DebugEventEnvelope> {
	entries: E[];
	dropped: number;
	nextId: number;
}

export const emptyDebugEventLog = <
	E extends DebugEventEnvelope,
>(): DebugEventLog<E> => ({ entries: [], dropped: 0, nextId: 1 });

/**
 * Appends one event. Past the cap, **the oldest entry is dropped and the count is recorded**.
 *
 * The studio console already uses the same shape (`runtime-preview-console.ts`), so the capped-list
 * rule does not exist in two versions in this repository.
 */
export function appendDebugEvent<E extends DebugEventEnvelope>(
	log: DebugEventLog<E>,
	event: Omit<E, "id">,
	limits: DebugTraceLimits,
): DebugEventLog<E> {
	const entries = [...log.entries, { ...event, id: log.nextId } as E];
	const overflow = Math.max(0, entries.length - limits.maxEvents);
	return {
		entries: overflow > 0 ? entries.slice(overflow) : entries,
		dropped: log.dropped + overflow,
		nextId: log.nextId + 1,
	};
}

/**
 * Truncates text that exceeds the limit, and **records the truncation as a value**.
 *
 * Appending only `…` would leave the screen unable to tell whether the code cut the text or the
 * source text ends that way.
 */
export interface ClampedText {
	text: string;
	/** Length of the original text. Equals `text.length` when nothing was cut. */
	length: number;
	truncated: boolean;
}

export const clampDebugText = (text: string, limit: number): ClampedText =>
	text.length <= limit
		? { text, length: text.length, truncated: false }
		: { text: text.slice(0, limit), length: text.length, truncated: true };

export type ConversationTurnOrigin = "send" | "regenerate" | "continue";

/** Why a turn did not reach commit. **The three reasons are different facts.** */
export type ConversationTurnDiscardReason =
	/**
	 * The conversation the turn started on is no longer active (account switch, reset, or tail
	 * rewrite).
	 */
	| "ownership"
	/**
	 * There is no body to save (an empty response, or a response that contains only a tracking block).
	 */
	| "empty"
	/** The continuation's premise no longer holds (the conversation moved on in the meantime). */
	| "precondition";

/**
 * What this turn was actually executed with, not what was requested.
 *
 * `target` is the value after `resolveGenerationExecution` has run. That is the point of this type.
 * Recording the requested target would leave the inspector unable to answer 'why did the response
 * come from a different model than the one I picked?'
 */
export interface ConversationTurnExecution {
	target: GenerationTarget;
	/**
	 * Whether the request goes through the RowCat server. Same meaning as whether the operator's
	 * managed key could have been spent.
	 */
	managed: boolean;
	reasoningEffort: ReasoningEffort | null;
	responseLength: ResponseLength | null;
	maxOutputTokens: number;
	/**
	 * The rating decision for this request. It is the result of the work's rating combined with the
	 * viewer's eligibility.
	 */
	allAges: boolean;
	/**
	 * Whether the narration pack actually applied. The alias is not carried, since it never flows
	 * through this repository.
	 */
	narrationApplied: boolean;
}

/**
 * Safe representation of a provider failure. The raw message never reaches this layer.
 *
 * The BYO path throws whatever the provider SDK throws, and what that message contains depends on
 * the day. This repository has already hit that once (the runtime preview's
 * `runtime-preview-generation-failure.ts` reached the same conclusion). So the screen reads only a
 * sentence selected from a fixed table, and the raw text is stored nowhere.
 */
export interface SafeGenerationFailure {
	/** Exception name (`AbortError`, `Error`). A class name carries no secrets. */
	name: string;
	code: string | null;
	/** **One line written by this code**, not the provider's raw text. */
	summary: string;
}

/**
 * The four session-opening events carry the **same fact**: what the session is being tested with.
 *
 * They share one shape because on screen they read as one line: 'this session opened this way, its
 * opening is this, and there are N lore entries'. If the reset event alone omitted that fact, the
 * timeline would not show what is running at that point.
 */
export interface ConversationSessionSignalData {
	sessionId: string;
	startSceneId: string | null;
	loreCount: number;
	startSceneCount: number;
}

export type ConversationDebugSignal =
	| {
			kind:
				| "session-started"
				| "session-reset"
				| "session-reloaded"
				| "scene-selected";
			data: ConversationSessionSignalData;
	  }
	| { kind: "input-accepted"; turnId: string; data: { characters: number } }
	| { kind: "input-rejected"; turnId: string; data: { reason: string } }
	| {
			kind: "prompt-assembled";
			turnId: string;
			/** **Heavy values come in here, and the event keeps only counts** (see the reducer below). */
			data: { prompt: ChatPromptTrace; request: SafeChatRequestDebug };
	  }
	| {
			kind: "provider-request";
			turnId: string;
			data: ConversationTurnExecution;
	  }
	| {
			kind: "provider-response";
			turnId: string;
			data: {
				end: ChatGenerationEnd;
				outputCharacters: number;
				usage: ChatGenerationUsage | null;
				finishReason: string | null;
			};
	  }
	| {
			kind: "generation-failed";
			turnId: string;
			data: SafeGenerationFailure;
	  }
	| {
			kind: "turn-committed";
			turnId: string;
			data: { messageId: string | null };
	  }
	| {
			kind: "turn-discarded";
			turnId: string;
			data: { reason: ConversationTurnDiscardReason };
	  };

/**
 * The event as stored: the signal with heavy values stripped out.
 *
 * Having two unions looks costly, but the reverse costs more. If full prompt text went into events,
 * a list capped at 500 entries would hold 500 prompts, and that memory would belong to a tab the
 * creator never opened. Heavy values live in one place, the turn record, and events keep only
 * counts.
 *
 * `kind` is the same word in both unions, so the reducer's mapping can be checked by eye.
 */
export type ConversationDebugEvent = DebugEventEnvelope &
	(
		| {
				kind:
					| "session-started"
					| "session-reset"
					| "session-reloaded"
					| "scene-selected";
				data: { sessionId: string; startSceneId: string | null };
		  }
		| { kind: "turn-started"; data: { origin: ConversationTurnOrigin } }
		| { kind: "input-accepted"; data: { characters: number } }
		| { kind: "input-rejected"; data: { reason: string } }
		| { kind: "lore-selected"; data: { evaluated: number; active: number } }
		| {
				kind: "prompt-assembled";
				data: { blocks: number; systemCharacters: number; messages: number };
		  }
		| {
				kind: "provider-request";
				data: { provider: string; model: string; managed: boolean };
		  }
		| {
				kind: "provider-response";
				data: { end: ChatGenerationEnd; outputCharacters: number };
		  }
		| { kind: "generation-failed"; data: SafeGenerationFailure }
		| { kind: "turn-committed"; data: { messageId: string | null } }
		| {
				kind: "turn-discarded";
				data: { reason: ConversationTurnDiscardReason };
		  }
	);

export type ConversationDebugEventKind = ConversationDebugEvent["kind"];

/**
 * One turn's status.
 *
 * `committed` and `discarded` must stay distinct. `committed` means the response was really
 * appended to the conversation. `discarded` means the response arrived but was not appended.
 * Folding them into one value would leave the inspector unable to answer 'why is there no reply on
 * screen?'
 */
export type ConversationTurnStatus =
	| "running"
	| "committed"
	| "discarded"
	| "failed"
	| "stopped";

export interface ConversationTurnRecord {
	turnId: string;
	/** Which turn this is within the session, counting from 1. It is the label shown on screen. */
	index: number;
	origin: ConversationTurnOrigin;
	startedAt: number;
	endedAt: number | null;
	status: ConversationTurnStatus;
	/** The prompt actually assembled for this turn. `null` for turns that ended before assembly. */
	prompt: ChatPromptTrace | null;
	/** Safe projection of the request as sent. Credentials have no place in this shape. */
	request: SafeChatRequestDebug | null;
	execution: ConversationTurnExecution | null;
	end: ChatGenerationEnd | null;
	finishReason: string | null;
	/** Usage **reported by the provider**. `null` when the provider did not report it. It is not 0. */
	usage: ChatGenerationUsage | null;
	/** Character count of the user utterance. Absent for continuations and regenerations. */
	inputCharacters: number | null;
	/** Character count of the response body received. **An exact value**, not an estimate. */
	outputCharacters: number | null;
	failure: SafeGenerationFailure | null;
	discardReason: ConversationTurnDiscardReason | null;
	/** The assistant message this turn produced. `null` if it was not appended. */
	messageId: string | null;
	/** Whether any value in this record was cut short by a limit. */
	truncated: boolean;
}

export interface ConversationDebugState {
	log: DebugEventLog<ConversationDebugEvent>;
	/** Oldest first, newest last. The screen reads from the end. */
	turns: ConversationTurnRecord[];
	droppedTurns: number;
	/**
	 * Total number of turns started in this session, including dropped ones. This is the source of
	 * `index`.
	 */
	startedTurns: number;
}

export const emptyConversationDebugState = (): ConversationDebugState => ({
	log: emptyDebugEventLog<ConversationDebugEvent>(),
	turns: [],
	droppedTurns: 0,
	startedTurns: 0,
});

/**
 * The one-line summary is a display string, not a contract. `kind` is carried alongside so the
 * screen never branches on this sentence (see the envelope comment).
 */
function summarize(signal: ConversationDebugSignal): string {
	switch (signal.kind) {
		case "session-started":
			return `Test session opened (${signal.data.loreCount} lore entries)`;
		case "session-reset":
			return "Cleared the conversation; the snapshot is unchanged";
		case "session-reloaded":
			return "Reopened from the latest draft; the manuscript may have changed";
		case "scene-selected":
			return signal.data.startSceneId
				? "Changed the opening scene"
				: "Returned to the draft's default opening";
		case "input-accepted":
			return `Input saved to the conversation (${signal.data.characters} characters)`;
		case "input-rejected":
			return "Could not save the input";
		case "prompt-assembled":
			return `Assembled the prompt (${signal.data.prompt.blocks.length} blocks)`;
		case "provider-request":
			return `Sent the request (${signal.data.target.model})`;
		case "provider-response":
			return `Response finished (${signal.data.end}, ${signal.data.outputCharacters} characters)`;
		case "generation-failed":
			return signal.data.summary;
		case "turn-committed":
			return "Saved the response to the conversation";
		case "turn-discarded":
			return signal.data.reason === "ownership"
				? "Not saved: this conversation was no longer active"
				: signal.data.reason === "empty"
					? "Not saved: there was no body to save"
					: "Not started: the continuation's precondition broke";
	}
}

/**
 * Folds long prompt-trace text within the limit. The fact that it was cut is recorded in the turn
 * record.
 */
function clampPrompt(
	prompt: ChatPromptTrace,
	limits: DebugTraceLimits,
): { prompt: ChatPromptTrace; truncated: boolean } {
	let truncated = false;
	const blocks = prompt.blocks.map((block) => {
		const clamped = clampDebugText(block.text, limits.maxTextLength);
		if (clamped.truncated) truncated = true;
		return clamped.truncated ? { ...block, text: clamped.text } : block;
	});
	return {
		prompt: truncated ? { ...prompt, blocks } : prompt,
		truncated,
	};
}

function clampRequest(
	request: SafeChatRequestDebug,
	limits: DebugTraceLimits,
): { request: SafeChatRequestDebug; truncated: boolean } {
	let truncated = false;
	const system = clampDebugText(request.system, limits.maxTextLength);
	if (system.truncated) truncated = true;
	const messages = request.messages.map((message) => {
		const clamped = clampDebugText(message.content, limits.maxTextLength);
		if (clamped.truncated) truncated = true;
		return clamped.truncated ? { ...message, content: clamped.text } : message;
	});
	return {
		request: truncated
			? { ...request, system: system.text, messages }
			: request,
		truncated,
	};
}

/** Patches the last turn in place. If there is no such turn, nothing happens. */
function patchTurn(
	turns: ConversationTurnRecord[],
	turnId: string,
	patch: (turn: ConversationTurnRecord) => ConversationTurnRecord,
): ConversationTurnRecord[] {
	const index = turns.findIndex((turn) => turn.turnId === turnId);
	/**
	 * Never creates a missing turn. Late signals from a turn that the cap already dropped arrive here.
	 * If the record were recreated at that point, the turn would become a ghost holding only a result,
	 * with no start or prompt, and the list order would break.
	 */
	if (index < 0) return turns;
	const next = [...turns];
	next[index] = patch(turns[index] as ConversationTurnRecord);
	return next;
}

export interface ConversationDebugReduceOptions {
	at: number;
	limits?: DebugTraceLimits;
}

/**
 * Starts a turn: the event and the turn record come into being together.
 *
 * The turn id is passed separately because of where it comes from. The app issues it (web uses
 * `crypto.randomUUID`, mobile uses `newLocalId`). This pure layer has no random source.
 */
export function beginConversationTurn(
	state: ConversationDebugState,
	turn: { turnId: string; origin: ConversationTurnOrigin },
	options: ConversationDebugReduceOptions,
): ConversationDebugState {
	const limits = options.limits ?? DEFAULT_DEBUG_TRACE_LIMITS;
	const index = state.startedTurns + 1;
	const record: ConversationTurnRecord = {
		turnId: turn.turnId,
		index,
		origin: turn.origin,
		startedAt: options.at,
		endedAt: null,
		status: "running",
		prompt: null,
		request: null,
		execution: null,
		end: null,
		finishReason: null,
		usage: null,
		inputCharacters: null,
		outputCharacters: null,
		failure: null,
		discardReason: null,
		messageId: null,
		truncated: false,
	};
	const grown = [...state.turns, record];
	const overflow = Math.max(0, grown.length - limits.maxTurns);
	return {
		log: appendDebugEvent<ConversationDebugEvent>(
			state.log,
			{
				at: options.at,
				turnId: turn.turnId,
				summary:
					turn.origin === "send"
						? "Started the turn"
						: turn.origin === "regenerate"
							? "Started regenerating"
							: "Started continuing",
				kind: "turn-started",
				data: { origin: turn.origin },
			},
			limits,
		),
		turns: overflow > 0 ? grown.slice(overflow) : grown,
		droppedTurns: state.droppedTurns + overflow,
		startedTurns: index,
	};
}

/**
 * Folds one signal into one event, plus an update to the turn record if there is one.
 *
 * Lore produces two events from one `prompt-assembled` signal. The assembler returns both as one
 * value, since lore selection is part of assembly. Splitting the signal would create two
 * instrumentation points, and one of them could be forgotten.
 */
export function reduceConversationDebug(
	state: ConversationDebugState,
	signal: ConversationDebugSignal,
	options: ConversationDebugReduceOptions,
): ConversationDebugState {
	const limits = options.limits ?? DEFAULT_DEBUG_TRACE_LIMITS;
	const turnId = "turnId" in signal ? signal.turnId : null;
	const base = { at: options.at, turnId, summary: summarize(signal) };

	const emit = (
		log: DebugEventLog<ConversationDebugEvent>,
		event: Omit<ConversationDebugEvent, "id" | "at" | "turnId" | "summary"> & {
			summary?: string;
		},
	): DebugEventLog<ConversationDebugEvent> =>
		appendDebugEvent<ConversationDebugEvent>(
			log,
			{ ...base, ...event } as Omit<ConversationDebugEvent, "id">,
			limits,
		);

	switch (signal.kind) {
		case "session-started":
		case "session-reset":
		case "session-reloaded":
		case "scene-selected":
			return {
				...state,
				log: emit(state.log, {
					kind: signal.kind,
					data: {
						sessionId: signal.data.sessionId,
						startSceneId: signal.data.startSceneId,
					},
				}),
			};
		case "input-accepted":
			return {
				log: emit(state.log, {
					kind: "input-accepted",
					data: { characters: signal.data.characters },
				}),
				turns: patchTurn(state.turns, signal.turnId, (turn) => ({
					...turn,
					inputCharacters: signal.data.characters,
				})),
				droppedTurns: state.droppedTurns,
				startedTurns: state.startedTurns,
			};
		case "input-rejected":
			return {
				log: emit(state.log, {
					kind: "input-rejected",
					data: { reason: signal.data.reason },
				}),
				turns: patchTurn(state.turns, signal.turnId, (turn) => ({
					...turn,
					status: "failed",
					endedAt: options.at,
				})),
				droppedTurns: state.droppedTurns,
				startedTurns: state.startedTurns,
			};
		case "prompt-assembled": {
			const prompt = clampPrompt(signal.data.prompt, limits);
			const request = clampRequest(signal.data.request, limits);
			const active = prompt.prompt.lore.filter(
				(decision) => decision.active,
			).length;
			const withLore = emit(state.log, {
				kind: "lore-selected",
				summary: `${active} of ${prompt.prompt.lore.length} lore entries matched`,
				data: { evaluated: prompt.prompt.lore.length, active },
			});
			return {
				log: appendDebugEvent<ConversationDebugEvent>(
					withLore,
					{
						...base,
						kind: "prompt-assembled",
						data: {
							blocks: prompt.prompt.blocks.length,
							systemCharacters: request.request.system.length,
							messages: request.request.messages.length,
						},
					},
					limits,
				),
				turns: patchTurn(state.turns, signal.turnId, (turn) => ({
					...turn,
					prompt: prompt.prompt,
					request: request.request,
					truncated: turn.truncated || prompt.truncated || request.truncated,
				})),
				droppedTurns: state.droppedTurns,
				startedTurns: state.startedTurns,
			};
		}
		case "provider-request":
			return {
				log: emit(state.log, {
					kind: "provider-request",
					data: {
						provider: signal.data.target.provider,
						model: signal.data.target.model,
						managed: signal.data.managed,
					},
				}),
				turns: patchTurn(state.turns, signal.turnId, (turn) => ({
					...turn,
					execution: signal.data,
				})),
				droppedTurns: state.droppedTurns,
				startedTurns: state.startedTurns,
			};
		case "provider-response":
			return {
				log: emit(state.log, {
					kind: "provider-response",
					data: {
						end: signal.data.end,
						outputCharacters: signal.data.outputCharacters,
					},
				}),
				turns: patchTurn(state.turns, signal.turnId, (turn) => ({
					...turn,
					end: signal.data.end,
					finishReason: signal.data.finishReason,
					/**
					 * Usage the provider did not report stays `null`. Filling it with 0 would merge 'the provider
					 * did not say' with 'it really was 0'. The billing layer in this repository already reached
					 * the same conclusion.
					 */
					usage: signal.data.usage,
					outputCharacters: signal.data.outputCharacters,
				})),
				droppedTurns: state.droppedTurns,
				startedTurns: state.startedTurns,
			};
		case "generation-failed":
			return {
				log: emit(state.log, {
					kind: "generation-failed",
					data: signal.data,
				}),
				turns: patchTurn(state.turns, signal.turnId, (turn) => ({
					...turn,
					failure: signal.data,
				})),
				droppedTurns: state.droppedTurns,
				startedTurns: state.startedTurns,
			};
		case "turn-committed":
			return {
				log: emit(state.log, {
					kind: "turn-committed",
					data: { messageId: signal.data.messageId },
				}),
				turns: patchTurn(state.turns, signal.turnId, (turn) => ({
					...turn,
					status: "committed",
					endedAt: options.at,
					messageId: signal.data.messageId,
				})),
				droppedTurns: state.droppedTurns,
				startedTurns: state.startedTurns,
			};
		case "turn-discarded":
			return {
				log: emit(state.log, {
					kind: "turn-discarded",
					data: { reason: signal.data.reason },
				}),
				turns: patchTurn(state.turns, signal.turnId, (turn) => ({
					...turn,
					/**
					 * A stop is not a failure. The user ended it themselves, so no failure status is attached (the
					 * generation lifecycle makes the same call).
					 */
					status:
						turn.end === "stopped"
							? "stopped"
							: turn.end === "failed" || turn.failure
								? "failed"
								: "discarded",
					endedAt: options.at,
					discardReason: signal.data.reason,
				})),
				droppedTurns: state.droppedTurns,
				startedTurns: state.startedTurns,
			};
	}
}

/**
 * The only debug interface the generation lifecycle knows.
 *
 * It has two functions. `beginTurn` returns the identity, which is the point. The app produces that
 * value (the clock and random source belong to the app), so the pure layer cannot create it. The
 * lifecycle holds it and attaches it to every later signal. As a result, a signal from a
 * late-finishing turn has no place to attach in a new turn.
 */
export interface ConversationDebugSink {
	beginTurn(origin: ConversationTurnOrigin): string;
	emit(signal: ConversationDebugSignal): void;
}

export interface ConversationDebugStore extends ConversationDebugSink {
	getState(): ConversationDebugState;
	subscribe(listener: () => void): () => void;
}

/**
 * A single in-memory observation store.
 *
 * It does not know React. It is only a shape that `useSyncExternalStore` could subscribe to. The
 * clock and the id generator are passed in because they are platform-specific: web uses
 * `crypto.randomUUID`, and mobile uses `newLocalId` (Hermes lacks the former).
 *
 * There is one store per replay session. When the session object changes, a new store is created
 * and nobody reads the old one. A generation still running when the session changes sends its
 * signals to the old store, which the screen never reads. That is what 'a late result does not
 * attach to a new session' means.
 */
export function createConversationDebugStore(options: {
	now: () => number;
	newTurnId: () => string;
	limits?: Partial<DebugTraceLimits>;
}): ConversationDebugStore {
	const limits: DebugTraceLimits = {
		...DEFAULT_DEBUG_TRACE_LIMITS,
		...options.limits,
	};
	let state = emptyConversationDebugState();
	const listeners = new Set<() => void>();
	/**
	 * **Observation must never fail a conversation turn.**
	 *
	 * This notification runs synchronously in the middle of the generation lifecycle. If one
	 * subscriber throws, the exception escapes past a turn that already succeeded and its committed
	 * save, and the user sees the answer alongside an error message. `ConversationSession.maintain`
	 * follows the same rule for the same reason.
	 *
	 * If one subscriber throws, **the rest are still notified**. Stopping at the first exception would
	 * silently leave every later screen un-updated, with nothing reporting it.
	 */
	const notify = () => {
		for (const listener of listeners)
			try {
				listener();
			} catch {
				// The subscriber's problem. The conversation must finish regardless of this record.
			}
	};

	return {
		beginTurn(origin) {
			const turnId = options.newTurnId();
			state = beginConversationTurn(
				state,
				{ turnId, origin },
				{ at: options.now(), limits },
			);
			notify();
			return turnId;
		},
		emit(signal) {
			state = reduceConversationDebug(state, signal, {
				at: options.now(),
				limits,
			});
			notify();
		},
		getState: () => state,
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
	};
}

/**
 * The turn that produced this message. `null` if there is none (the turn was pushed out past the
 * limit, or instrumentation was not in place).
 */
export const turnForMessage = (
	state: ConversationDebugState,
	messageId: string,
): ConversationTurnRecord | null =>
	state.turns.find((turn) => turn.messageId === messageId) ?? null;

/**
 * Only this turn's events. Order is by `id`, not by time, since identical milliseconds are common.
 */
export const eventsForTurn = (
	state: ConversationDebugState,
	turnId: string,
): ConversationDebugEvent[] =>
	state.log.entries.filter((event) => event.turnId === turnId);

/**
 * The most recent turn: the default selection when the screen has picked nothing.
 *
 * It returns the turn still in progress as is. If only finished turns were chosen, then while a
 * response streams the inspector would show the **previous** turn, and someone asking which prompt
 * was just sent would get another turn's answer.
 */
export const latestTurn = (
	state: ConversationDebugState,
): ConversationTurnRecord | null =>
	state.turns.length > 0
		? (state.turns[state.turns.length - 1] as ConversationTurnRecord)
		: null;

/**
 * Whether anything was dropped by a limit. This is the basis for the screen to state that the list
 * is not complete.
 */
export const debugTraceTruncated = (state: ConversationDebugState): boolean =>
	state.log.dropped > 0 ||
	state.droppedTurns > 0 ||
	state.turns.some((turn) => turn.truncated);
