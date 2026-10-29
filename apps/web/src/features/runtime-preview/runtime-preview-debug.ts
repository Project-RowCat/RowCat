import {
	appendDebugEvent,
	type DebugEventEnvelope,
	type DebugEventLog,
	type DebugTraceLimits,
	emptyDebugEventLog,
} from "@rowcat/chat";
import type { RuntimePersistentStateSnapshot } from "@rowcat/runtime-host/persistent-state";
import type { RuntimeStoryStateSnapshot } from "@rowcat/runtime-host/story-state";
import { deferredTranslator } from "#/lib/i18n/current.ts";
import type { PreviewGeneration, PreviewWorkerMessage } from "./protocol.ts";
import {
	formatStoryStateValue,
	type StoryStateFormatLimits,
} from "./runtime-preview-story-state.ts";

const tr = deferredTranslator("runtimePreview");

/**
 * Observation record for the runtime preview, kept beside the execution path.
 * - It shares its envelope and buffer with the conversation branch (`debug-trace.ts` in
 *   `@rowcat/chat`). Commit, control, save and migration vocabulary stays here so that
 *   `@rowcat/chat` never learns about the runtime, and mobile has no studio at all.
 * - It reads only messages that already flow. It adds no protocol fields and does not change
 *   commit order or save timing; any of those moving would turn the debugger into a second
 *   execution path.
 * - It cannot answer for values pending uncommitted, because those never leave the VM. Missing
 *   answers are left missing, not invented.
 */

/** Which lifetime a durable state belongs to. The two key spaces never mix. */
export type RuntimeDurableScope = "story" | "persistent";

export type RuntimeDebugEvent = DebugEventEnvelope &
	(
		| {
				kind: "run-requested";
				data: { resetStory: boolean; resetPersistent: boolean };
		  }
		| { kind: "session-started"; data: { remoteAssets: number } }
		| { kind: "commit"; data: { revision: number; patches: number } }
		| { kind: "commands"; data: { revision: number; commands: number } }
		| {
				kind: "durable-commit";
				data: {
					scope: RuntimeDurableScope;
					entries: number;
					changedKeys: string[];
					/** Revision of the commit this snapshot followed. `null` immediately after hydration. */
					revision: number | null;
				};
		  }
		| {
				kind: "migration";
				data: {
					scope: RuntimeDurableScope;
					key: string;
					from: number;
					to: number;
				};
		  }
		| {
				kind: "diagnostic";
				data: {
					code: string | null;
					message: string;
					component: string | null;
				};
		  }
		| {
				kind: "root-error";
				data: {
					work: "render" | "effects" | "event";
					name: string;
					message: string;
					code: string | null;
				};
		  }
		| {
				kind: "generation-request";
				data: { requestId: number; messages: number; characters: number };
		  }
		| {
				kind: "generation-result";
				data: { requestId: number; ok: boolean; reason: string | null };
		  }
		| {
				kind: "session-failed";
				data: { stage: string; summary: string; diagnostics: number };
		  }
		| { kind: "session-stopped"; data: { cleanups: number } }
	);

export type RuntimeDebugEventKind = RuntimeDebugEvent["kind"];

/* Durable-state rows. The screen reads nothing beyond this point. */

/**
 * One row of the `State` cell. The runtime host's types end at this projection by design: the
 * creator test folder imports neither the compiler nor the VM (a static scan enforces that), and
 * the screen sees only the key, the version and the text.
 */
export interface RuntimeDurableRow {
	key: string;
	/** The creator's schema version. Migration raises it. */
	version: number;
	text: string;
	/**
	 * The value at the previous commit. `null` means the slot has not changed at all in this session,
	 * not that no value existed. Attaching a fake previous value right after hydration would draw a
	 * change where nothing happened.
	 */
	previous: string | null;
	changedAtLastCommit: boolean;
}

export interface RuntimeDurableView {
	rows: RuntimeDurableRow[];
	/**
	 * Whether a snapshot for this lifetime has arrived at least once. `false` means the session has
	 * not started yet.
	 */
	hydrated: boolean;
}

const emptyDurableView = (): RuntimeDurableView => ({
	rows: [],
	hydrated: false,
});

export interface RuntimeDebugState {
	log: DebugEventLog<RuntimeDebugEvent>;
	story: RuntimeDurableView;
	persistent: RuntimeDurableView;
	/**
	 * Revision of the last commit seen in this session. This ties a durable snapshot to that commit.
	 */
	lastRevision: number | null;
	/**
	 * Execution generation currently observed. Messages from any other generation produce no state.
	 */
	generation: PreviewGeneration | null;
}

export const emptyRuntimeDebugState = (): RuntimeDebugState => ({
	log: emptyDebugEventLog<RuntimeDebugEvent>(),
	story: emptyDurableView(),
	persistent: emptyDurableView(),
	lastRevision: null,
	generation: null,
});

/* Reducers are pure. The clock is passed in from outside. */

export interface RuntimeDebugReduceOptions {
	at: number;
	limits: DebugTraceLimits;
	/**
	 * Upper bound for folding values into text. Uses the same function and the same limits as the
	 * `State` cell.
	 */
	format?: StoryStateFormatLimits;
}

type DurableSnapshot =
	| RuntimeStoryStateSnapshot
	| RuntimePersistentStateSnapshot;

/**
 * Folds one snapshot into rows and compares each with the previous row. A key whose version rose is
 * a migration candidate. That judgement only means something right after hydration, because the
 * creator's definition is fixed during execution and the version cannot rise then.
 */
function foldDurable(
	previous: RuntimeDurableView,
	snapshot: DurableSnapshot,
	format: StoryStateFormatLimits | undefined,
): {
	view: RuntimeDurableView;
	changedKeys: string[];
	migrations: { key: string; from: number; to: number }[];
} {
	const before = new Map(previous.rows.map((row) => [row.key, row]));
	const changedKeys: string[] = [];
	const migrations: { key: string; from: number; to: number }[] = [];

	const rows = snapshot.entries.map((entry) => {
		const text = format
			? formatStoryStateValue(entry.value, format)
			: formatStoryStateValue(entry.value);
		const prior = before.get(entry.key);
		const changed = prior !== undefined && prior.text !== text;
		if (changed) changedKeys.push(entry.key);
		if (prior !== undefined && prior.version < entry.version)
			migrations.push({
				key: entry.key,
				from: prior.version,
				to: entry.version,
			});
		return {
			key: entry.key,
			version: entry.version,
			text,
			/**
			 * When a value changed, the previous value is the prior one; otherwise the previously known
			 * previous value is carried over. If every commit overwrote the previous value with the current
			 * one, 'what changed at the last commit' would always read as nothing. The last change at a slot
			 * that did not move stays true until the slot moves again.
			 */
			previous: changed ? (prior?.text ?? null) : (prior?.previous ?? null),
			changedAtLastCommit: changed,
		} satisfies RuntimeDurableRow;
	});

	return {
		view: { rows, hydrated: true },
		changedKeys,
		migrations,
	};
}

/**
 * Run was pressed. A generation change restarts observation too. Saved snapshots survive a restart,
 * which is why restart and playthrough reset are different operations. Observation's previous
 * values do not survive: attaching the old session's values to the new session's first snapshot
 * would draw changes that never happened.
 */
export function runtimeDebugRun(
	state: RuntimeDebugState,
	input: {
		generation: PreviewGeneration;
		resetStory: boolean;
		resetPersistent: boolean;
	},
	options: RuntimeDebugReduceOptions,
): RuntimeDebugState {
	return {
		log: appendDebugEvent<RuntimeDebugEvent>(
			state.log,
			{
				at: options.at,
				turnId: null,
				summary: input.resetStory
					? tr("debug.runWithReset")
					: input.resetPersistent
						? tr("debug.runWithPersistentReset")
						: tr("debug.runStarted"),
				kind: "run-requested",
				data: {
					resetStory: input.resetStory,
					resetPersistent: input.resetPersistent,
				},
			},
			options.limits,
		),
		story: emptyDurableView(),
		persistent: emptyDurableView(),
		lastRevision: null,
		generation: input.generation,
	};
}

/**
 * Folds one worker message. Messages from another generation produce no state. The state machine
 * makes the same judgement (runtime-preview-state.ts). If this made a different one, observation
 * would describe a different session than the screen shows.
 */
export function reduceRuntimeDebug(
	state: RuntimeDebugState,
	message: PreviewWorkerMessage,
	options: RuntimeDebugReduceOptions,
): RuntimeDebugState {
	if (state.generation !== null && message.generation !== state.generation)
		return state;

	const emit = (
		event: Omit<RuntimeDebugEvent, "id" | "at" | "turnId">,
	): DebugEventLog<RuntimeDebugEvent> =>
		appendDebugEvent<RuntimeDebugEvent>(
			state.log,
			{ ...event, at: options.at, turnId: null } as Omit<
				RuntimeDebugEvent,
				"id"
			>,
			options.limits,
		);

	switch (message.type) {
		case "started":
			return {
				...state,
				log: emit({
					kind: "session-started",
					summary: tr("debug.sessionStarted"),
					data: { remoteAssets: message.remoteAssets.length },
				}),
			};
		case "commit":
			return {
				...state,
				lastRevision: message.batch.revision,
				log: emit({
					kind: "commit",
					summary: tr("debug.commit", {
						revision: message.batch.revision,
						count: message.batch.patches.length,
					}),
					data: {
						revision: message.batch.revision,
						patches: message.batch.patches.length,
					},
				}),
			};
		case "commands":
			return {
				...state,
				log: emit({
					kind: "commands",
					summary: tr("debug.commands", {
						count: message.batch.commands.length,
					}),
					data: {
						revision: message.batch.revision,
						commands: message.batch.commands.length,
					},
				}),
			};
		case "story-state":
		case "persistent-state": {
			const scope: RuntimeDurableScope =
				message.type === "story-state" ? "story" : "persistent";
			const view = scope === "story" ? state.story : state.persistent;
			const folded = foldDurable(view, message.snapshot, options.format);
			/**
			 * The first snapshot creates no event. It is hydration, not a commit; recording it as a change
			 * would make every key look changed whenever a session is set up.
			 */
			let log = view.hydrated
				? emit({
						kind: "durable-commit",
						summary: tr(
							scope === "story" ? "debug.saveStory" : "debug.savePersistent",
							{ count: folded.changedKeys.length },
						),
						data: {
							scope,
							entries: message.snapshot.entries.length,
							changedKeys: folded.changedKeys,
							revision: state.lastRevision,
						},
					})
				: state.log;
			for (const migration of folded.migrations)
				log = appendDebugEvent<RuntimeDebugEvent>(
					log,
					{
						at: options.at,
						turnId: null,
						summary: tr("debug.migration", {
							key: migration.key,
							from: migration.from,
							to: migration.to,
						}),
						kind: "migration",
						data: { scope, ...migration },
					},
					options.limits,
				);
			return {
				...state,
				log,
				...(scope === "story"
					? { story: folded.view }
					: { persistent: folded.view }),
			};
		}
		case "diagnostic":
			return {
				...state,
				log: emit({
					kind: "diagnostic",
					summary: message.diagnostic.message,
					data: {
						code: message.diagnostic.code,
						message: message.diagnostic.message,
						component: message.diagnostic.component,
					},
				}),
			};
		case "root-error":
			return {
				...state,
				log: emit({
					kind: "root-error",
					summary: tr("debug.exception", {
						work: message.work,
						name: message.error.name,
					}),
					data: {
						work: message.work,
						name: message.error.name,
						message: message.error.message,
						code: message.error.code,
					},
				}),
			};
		case "generation-request":
			return {
				...state,
				log: emit({
					kind: "generation-request",
					summary: tr("debug.generationRequested"),
					data: {
						requestId: message.requestId,
						messages: message.request.messages.length,
						characters: message.request.instructions.length,
					},
				}),
			};
		case "failed":
			return {
				...state,
				log: emit({
					kind: "session-failed",
					summary: tr("debug.sessionFailed", { stage: message.failure.stage }),
					data: {
						stage: message.failure.stage,
						/**
						 * Compile diagnostics do not arrive here. They are code problems, while this file records
						 * execution events, and the repo already keeps the two apart (runtime-preview-console.ts).
						 * For a compile failure only a summary line is recorded.
						 */
						summary:
							message.failure.stage === "compile"
								? tr("debug.compileFailed")
								: message.failure.stage === "renderer" ||
										message.failure.stage === "worker"
									? message.failure.message
									: message.failure.error.name,
						diagnostics:
							message.failure.stage === "compile"
								? message.failure.diagnostics.length
								: 0,
					},
				}),
			};
		case "stopped":
			return {
				...state,
				log: emit({
					kind: "session-stopped",
					summary: tr("debug.sessionStopped", { count: message.cleanups }),
					data: { cleanups: message.cleanups },
				}),
			};
		default:
			/** `status` and `console` messages are not observation events. See the file header. */
			return state;
	}
}

export function runtimeDebugGenerationResult(
	state: RuntimeDebugState,
	input: { requestId: number; ok: boolean; reason: string | null },
	options: RuntimeDebugReduceOptions,
): RuntimeDebugState {
	return {
		...state,
		log: appendDebugEvent<RuntimeDebugEvent>(
			state.log,
			{
				at: options.at,
				turnId: null,
				summary: input.ok
					? tr("debug.generationReturned")
					: tr("debug.generationRefused", {
							reason: input.reason ?? "unknown",
						}),
				kind: "generation-result",
				data: input,
			},
			options.limits,
		),
	};
}
