import type { RuntimeConsoleLevel } from "@rowcat/runtime-host/capabilities";
import type { RuntimeCommandBatch } from "@rowcat/runtime-host/commands";
import type { RuntimePatchBatch } from "@rowcat/runtime-host/patches";
import type { PocReport, PocStep } from "@rowcat/runtime-host/poc/suite";
import type { RuntimeRootDiagnostic } from "@rowcat/runtime-host/session";
import type { RuntimeWireValue } from "@rowcat/runtime-host/wire";

/**
 * The **one message vocabulary** between native and the trusted runtime WebView. Pure.
 *
 * ```text
 * Hermes (trusted native adapter)  ──bridge──▶  WebView (WASM VM host)  ──▶  creator VM
 *                                 ◀──bridge───
 * ```
 *
 * Both directions are **JSON strings**. Functions, handles, promises and VM objects never cross,
 * and this file checks the shape. Not trusting the string the WebView sent is the same judgement as
 * not trusting the string the VM sent (the wire rules of `@rowcat/runtime-host`). Nothing here
 * depends on React Native or the WebView: the same file is read by the harness (browser realm) and
 * by the app (Hermes).
 *
 * ## Why one vocabulary
 *
 * Two kinds of conversation flow over this channel: the PoC suite (diagnostics) and **runtime
 * sessions** (product infrastructure). Two sets of variants would give the same bridge two
 * discriminators, and the receiver would have to guess which parser applies from the message's
 * shape. One `type` removes that guess.
 *
 * ## The generation rides on every runtime message
 *
 * Restarting creates a new session. If A is started, then B, and A's late commit arrives on B's
 * screen, that screen is wrong with no error. Message order alone cannot tell them apart (the
 * bridge is serial, but native state is already B). So native issues a monotonically increasing
 * number and the harness echoes it back on **every** runtime message. Messages with a different
 * number are discarded.
 *
 * ## What is not here
 *
 * The compiler, source and source maps never reach this channel (the input is an already-emitted
 * artifact). `PressEvent` and coordinates never go to the WebView; what goes out is the handler
 * **number**. Host file paths, engine internals and stacks are not carried in error projections.
 */

export type NativeRuntimeGeneration = number;

/** The screen projection of one error. Host paths and engine internals are not carried here. */
export interface NativeRuntimeErrorInfo {
	/** Whether creator code threw (`creator`) or the host, VM or a limit failed (`host`). */
	kind: "creator" | "host";
	name: string;
	message: string;
	/** A runtime code such as `runtime_hook_order_changed`, or a host error code. Absent for ordinary exceptions. */
	code: string | null;
	componentStack: string[];
}

export type NativeRuntimeFailure =
	| { stage: "start"; error: NativeRuntimeErrorInfo }
	| { stage: "runtime"; error: NativeRuntimeErrorInfo }
	| { stage: "renderer"; message: string }
	/** A failure of the bridge or renderer process. Created by the **transport layer**, not the harness. */
	| { stage: "transport"; message: string };

/* ── Native → WebView ─────────────────────────────────────────────────── */

export type NativeRuntimeToVm =
	/**
	 * Alive? The answer is a single `ready`.
	 *
	 * The document emits `ready` by itself when it loads. But that message is sent **once**. When the
	 * bridge is re-established (Fast Refresh during development, session replacement), an already
	 * loaded document does not send it again. The new bridge then never becomes ready, everything sent
	 * piles up in the queue, and the screen stays in `starting`. (A defect first seen on a physical
	 * device.)
	 */
	| { type: "hello" }
	/** The PoC diagnostic suite. Not the product path. */
	| { type: "poc-run"; platform: string }
	| {
			type: "host-result";
			id: number;
			ok: true;
			value: RuntimeWireValue;
	  }
	| { type: "host-result"; id: number; ok: false; message: string }
	/**
	 * A runtime session: sets up one artifact and **two storage snapshots**.
	 *
	 * The snapshots travel here as described in §83. SQLite records do not cross; only the
	 * host-neutral snapshot does, so this bridge does not know about storage. That is the
	 * protocol-side expression of the fact that there is no SQLite write path inside the WebView.
	 *
	 * All three are **optional** because of the diagnostic harness. `runtime-native-lab` runs one
	 * artifact with no storage and no generation, and that path uses this message as-is. If they were
	 * required, that screen would have to fabricate empty snapshots, and fabricated values eventually
	 * leak into the product path.
	 */
	| {
			type: "start";
			generation: NativeRuntimeGeneration;
			artifact: unknown;
			storyState?: unknown;
			persistentState?: unknown;
			/** Whether `useGeneration()` opens in this session. Closed when absent. */
			generationEnabled?: boolean;
	  }
	/**
	 * The answer to a runtime capability call — **a value made by Hermes**.
	 *
	 * Kept separate from the PoC's `host-result` because the consumers differ. That side is the
	 * diagnostic suite's conversation, this side is product generation. Under one name, the diagnostic
	 * harness's answer could fix a promise the creator's code relies on.
	 */
	| {
			type: "runtime-host-result";
			generation: NativeRuntimeGeneration;
			requestId: number;
			result: NativeRuntimeGenerationResult;
	  }
	| {
			type: "event";
			generation: NativeRuntimeGeneration;
			handlerId: number;
			/**
			 * The string a text input carried. Absent for presses; that slot is a call with no argument.
			 *
			 * This is a **value the renderer made**, not React Native's `NativeSyntheticEvent`. Only an
			 * integer and this string cross the bridge; native event objects go in neither direction.
			 */
			payload?: string;
			/**
			 * `media` for an event nobody pressed (a sound reaching its end). The session refuses generation
			 * for it; absent is an interaction. Hermes decides this at the audio callback.
			 */
			source?: "media";
	  }
	| { type: "stop"; generation: NativeRuntimeGeneration };

/* ── WebView → Native ─────────────────────────────────────────────────── */

export type NativeRuntimeFromVm =
	/** The harness document is up. It has no generation; it comes before any session. */
	| { type: "ready" }
	| { type: "poc-step"; step: PocStep }
	| { type: "poc-report"; report: PocReport }
	| { type: "poc-failure"; message: string }
	| {
			type: "host-call";
			id: number;
			capability: string;
			payload: RuntimeWireValue;
	  }
	| {
			type: "started";
			generation: NativeRuntimeGeneration;
			/**
			 * The **remote image addresses** this session is authorized for: the list the verified artifact
			 * declared.
			 *
			 * Hermes receives it over the bridge rather than reading the artifact itself. The host inside
			 * the WebView set up the session and its verification is the authority for the list, so reading
			 * it separately here would make a value that **never passed verification** the basis of the
			 * asset resolver. It arrives with the generation, so the previous session's list does not carry
			 * into the new one.
			 */
			remoteAssets: readonly string[];
	  }
	| {
			type: "commit";
			generation: NativeRuntimeGeneration;
			batch: RuntimePatchBatch;
	  }
	/**
	 * One batch of control commands (scroll, focus) — **arrives after the `commit` of the same
	 * commit.**
	 *
	 * The bridge preserves message order and Hermes processes in that order, so the deck receives the
	 * commands after the commit that grew the list has already reached the store.
	 */
	| {
			type: "commands";
			generation: NativeRuntimeGeneration;
			batch: RuntimeCommandBatch;
	  }
	| {
			type: "console";
			generation: NativeRuntimeGeneration;
			level: RuntimeConsoleLevel;
			args: RuntimeWireValue[];
	  }
	| {
			type: "diagnostic";
			generation: NativeRuntimeGeneration;
			diagnostic: RuntimeRootDiagnostic;
	  }
	| {
			type: "root-error";
			generation: NativeRuntimeGeneration;
			error: NativeRuntimeErrorInfo;
			work: "render" | "effects" | "event";
	  }
	| {
			type: "failed";
			generation: NativeRuntimeGeneration;
			failure: NativeRuntimeFailure;
	  }
	| {
			type: "stopped";
			generation: NativeRuntimeGeneration;
			cleanups: number;
	  }
	/**
	 * The **canonical snapshot** after hydration finishes — it arrives before mount.
	 *
	 * If a migration bumped the version, this value is the current state, and Hermes makes it durable
	 * in the product store (§84). Without this message the next session would re-run the same
	 * migration.
	 */
	| {
			type: "hydrated";
			generation: NativeRuntimeGeneration;
			storyState: unknown;
			persistentState: unknown;
	  }
	/** A committed playthrough. Hermes passes it to SQLite (§85). */
	| {
			type: "story-state";
			generation: NativeRuntimeGeneration;
			snapshot: unknown;
	  }
	/** A committed long progress. **A different message**, because its two lifetimes are separate. */
	| {
			type: "persistent-state";
			generation: NativeRuntimeGeneration;
			snapshot: unknown;
	  }
	/**
	 * The creator's code requested generation. **Answered by Hermes's trusted adapter** (§86).
	 *
	 * The fact that provider requests never happen inside the WebView or QuickJS is why this message
	 * exists. Credentials and transport are entirely in Hermes; what is carried here is only the
	 * values the creator wrote and the limits the host verified.
	 */
	| {
			type: "runtime-host-call";
			generation: NativeRuntimeGeneration;
			requestId: number;
			request: NativeRuntimeGenerationRequest;
	  };

/**
 * One generation request. **The provider, model, key and balance do not appear in this shape.**
 *
 * Hermes's trusted stack decides those axes. The WebView receives only the result without knowing
 * the decision (the same shape as the web preview and playback).
 */
export interface NativeRuntimeGenerationRequest {
	messages: { role: "user" | "assistant"; content: string }[];
	instructions: string;
	maxOutputCharacters: number;
}

/** The result: one text, or **one named reason**. The provider's original error never arrives here. */
export type NativeRuntimeGenerationResult =
	| { ok: true; text: string }
	| {
			ok: false;
			reason:
				| "unavailable"
				| "not-authorized"
				| "insufficient-balance"
				| "cancelled"
				| "failed";
			message: string;
	  };

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isGeneration = (value: unknown): value is number =>
	typeof value === "number" && Number.isInteger(value) && value >= 1;

/**
 * The shape of a generation request. **Values that crossed the bridge are not trusted.**
 *
 * This value came from QuickJS inside the WebView, the realm where creator code runs. The host has
 * already verified it, but what crosses the bridge is a string, so it is checked again here. A
 * request of the wrong shape reaching the trusted generation stack would make that stack send a
 * value to a provider that it never decided on.
 */
function parseGenerationRequest(
	value: unknown,
): NativeRuntimeGenerationRequest | null {
	if (!isRecord(value)) return null;
	if (typeof value.instructions !== "string") return null;
	if (
		typeof value.maxOutputCharacters !== "number" ||
		!Number.isFinite(value.maxOutputCharacters)
	)
		return null;
	if (!Array.isArray(value.messages)) return null;
	const messages: NativeRuntimeGenerationRequest["messages"] = [];
	for (const entry of value.messages) {
		if (!isRecord(entry)) return null;
		if (entry.role !== "user" && entry.role !== "assistant") return null;
		if (typeof entry.content !== "string") return null;
		messages.push({ role: entry.role, content: entry.content });
	}
	return {
		messages,
		instructions: value.instructions,
		maxOutputCharacters: value.maxOutputCharacters,
	};
}

const isStep = (value: unknown): value is PocStep =>
	isRecord(value) &&
	typeof value.name === "string" &&
	typeof value.ms === "number" &&
	Number.isFinite(value.ms);

function parseErrorInfo(value: unknown): NativeRuntimeErrorInfo | null {
	if (!isRecord(value)) return null;
	if (value.kind !== "creator" && value.kind !== "host") return null;
	if (typeof value.name !== "string" || typeof value.message !== "string")
		return null;
	if (value.code !== null && typeof value.code !== "string") return null;
	if (
		!Array.isArray(value.componentStack) ||
		!value.componentStack.every((frame) => typeof frame === "string")
	)
		return null;
	return {
		kind: value.kind,
		name: value.name,
		message: value.message,
		code: value.code,
		componentStack: [...(value.componentStack as string[])],
	};
}

function parseFailure(value: unknown): NativeRuntimeFailure | null {
	if (!isRecord(value)) return null;
	switch (value.stage) {
		case "start":
		case "runtime": {
			const error = parseErrorInfo(value.error);
			return error === null ? null : { stage: value.stage, error };
		}
		case "renderer":
		case "transport":
			return typeof value.message === "string"
				? { stage: value.stage, message: value.message }
				: null;
		default:
			return null;
	}
}

/**
 * A control command batch. Checks the shape only. **Authority over the values lives in the host
 * verification inside the WebView** (`validateCommandBatch`), and the deck compares the revision
 * once more.
 */
function parseCommands(value: unknown): RuntimeCommandBatch | null {
	if (!isRecord(value)) return null;
	if (typeof value.revision !== "number" || !Number.isInteger(value.revision))
		return null;
	if (!Array.isArray(value.commands)) return null;
	if (
		!value.commands.every(
			(command) =>
				isRecord(command) &&
				typeof command.op === "string" &&
				typeof command.control === "number",
		)
	)
		return null;
	return value as unknown as RuntimeCommandBatch;
}

/**
 * Checks the **shape** of a patch batch only. Each operation is verified by the host already
 * (`validatePatchBatch`); restating that here would create a second copy that drifts. What this
 * blocks is the shape the tree store would throw on while reading (a revision that is not a number,
 * patches that are not an array).
 */
function parseBatch(value: unknown): RuntimePatchBatch | null {
	if (!isRecord(value)) return null;
	if (!isGeneration(value.revision)) return null;
	if (!Array.isArray(value.patches)) return null;
	if (
		!value.patches.every(
			(patch) => isRecord(patch) && typeof patch.op === "string",
		)
	)
		return null;
	return value as unknown as RuntimePatchBatch;
}

const CONSOLE_LEVELS: ReadonlySet<string> = new Set(["log", "warn", "error"]);

/**
 * A string sent by the WebView → a message. Returns `null` when the shape is wrong, and does not
 * throw. The string comes from code we wrote, but this boundary's rule is not to trust it.
 */
export function parseRuntimeMessage(raw: string): NativeRuntimeFromVm | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!isRecord(parsed) || typeof parsed.type !== "string") return null;
	switch (parsed.type) {
		case "ready":
			return { type: "ready" };
		case "poc-step":
			return isStep(parsed.step)
				? { type: "poc-step", step: parsed.step }
				: null;
		case "poc-report":
			return isRecord(parsed.report) &&
				Array.isArray(parsed.report.steps) &&
				parsed.report.steps.every(isStep)
				? {
						type: "poc-report",
						report: {
							...(parsed.report as unknown as PocReport),
							/** Reports from the older harness lack this field; fold it to an empty list. */
							stackProbe: Array.isArray(parsed.report.stackProbe)
								? (parsed.report.stackProbe as PocReport["stackProbe"])
								: [],
						},
					}
				: null;
		case "poc-failure":
			return typeof parsed.message === "string"
				? { type: "poc-failure", message: parsed.message }
				: null;
		case "host-call":
			return typeof parsed.id === "number" &&
				typeof parsed.capability === "string" &&
				"payload" in parsed
				? {
						type: "host-call",
						id: parsed.id,
						capability: parsed.capability,
						payload: parsed.payload as RuntimeWireValue,
					}
				: null;
		case "started": {
			if (!isGeneration(parsed.generation)) return null;
			/**
			 * A harness without the list (an older build) folds to an **empty list**. That state means "no
			 * remote address was authorized". Folding the other way would open arbitrary remote addresses in
			 * that harness only, and that window is invisible on screen.
			 */
			const remoteAssets = Array.isArray(parsed.remoteAssets)
				? parsed.remoteAssets.filter(
						(entry): entry is string => typeof entry === "string",
					)
				: [];
			return { type: "started", generation: parsed.generation, remoteAssets };
		}
		case "commit": {
			if (!isGeneration(parsed.generation)) return null;
			const batch = parseBatch(parsed.batch);
			return batch === null
				? null
				: { type: "commit", generation: parsed.generation, batch };
		}
		case "commands": {
			if (!isGeneration(parsed.generation)) return null;
			const batch = parseCommands(parsed.commands ?? parsed.batch);
			return batch === null
				? null
				: { type: "commands", generation: parsed.generation, batch };
		}
		case "console":
			return isGeneration(parsed.generation) &&
				typeof parsed.level === "string" &&
				CONSOLE_LEVELS.has(parsed.level) &&
				Array.isArray(parsed.args)
				? {
						type: "console",
						generation: parsed.generation,
						level: parsed.level as RuntimeConsoleLevel,
						args: parsed.args as RuntimeWireValue[],
					}
				: null;
		case "diagnostic":
			return isGeneration(parsed.generation) &&
				isRecord(parsed.diagnostic) &&
				typeof parsed.diagnostic.code === "string" &&
				typeof parsed.diagnostic.message === "string"
				? {
						type: "diagnostic",
						generation: parsed.generation,
						diagnostic: parsed.diagnostic as unknown as RuntimeRootDiagnostic,
					}
				: null;
		case "root-error": {
			if (!isGeneration(parsed.generation)) return null;
			const error = parseErrorInfo(parsed.error);
			if (error === null) return null;
			if (
				parsed.work !== "render" &&
				parsed.work !== "effects" &&
				parsed.work !== "event"
			)
				return null;
			return {
				type: "root-error",
				generation: parsed.generation,
				error,
				work: parsed.work,
			};
		}
		case "failed": {
			if (!isGeneration(parsed.generation)) return null;
			const failure = parseFailure(parsed.failure);
			return failure === null
				? null
				: { type: "failed", generation: parsed.generation, failure };
		}
		case "stopped":
			return isGeneration(parsed.generation) &&
				typeof parsed.cleanups === "number"
				? {
						type: "stopped",
						generation: parsed.generation,
						cleanups: parsed.cleanups,
					}
				: null;
		/**
		 * The snapshots are **not validated here**. Authority over their shape belongs to the storage
		 * domain (`validateStoryStateSnapshot`). If the parser restated it, the same judgement would
		 * exist in two places, and they would diverge the day the storage format changes. What is checked
		 * here is one thing: whether a value that crossed the bridge is this kind of message.
		 */
		case "hydrated":
			return isGeneration(parsed.generation) &&
				"storyState" in parsed &&
				"persistentState" in parsed
				? {
						type: "hydrated",
						generation: parsed.generation,
						storyState: parsed.storyState,
						persistentState: parsed.persistentState,
					}
				: null;
		case "story-state":
			return isGeneration(parsed.generation) && "snapshot" in parsed
				? {
						type: "story-state",
						generation: parsed.generation,
						snapshot: parsed.snapshot,
					}
				: null;
		case "persistent-state":
			return isGeneration(parsed.generation) && "snapshot" in parsed
				? {
						type: "persistent-state",
						generation: parsed.generation,
						snapshot: parsed.snapshot,
					}
				: null;
		case "runtime-host-call": {
			if (!isGeneration(parsed.generation)) return null;
			if (typeof parsed.requestId !== "number") return null;
			const request = parseGenerationRequest(parsed.request);
			return request === null
				? null
				: {
						type: "runtime-host-call",
						generation: parsed.generation,
						requestId: parsed.requestId,
						request,
					};
		}
		default:
			return null;
	}
}

/**
 * The **native-side answer** to a PoC capability.
 *
 * `test.slow` is not answered (`null`): that call is released from the harness side by a signal
 * when the session is discarded. The failure message deliberately includes native detail. That
 * message **not arriving in the VM** is what the suite checks.
 */
export function answerHostCall(
	call: Extract<NativeRuntimeFromVm, { type: "host-call" }>,
): NativeRuntimeToVm | null {
	switch (call.capability) {
		case "test.echo":
			return {
				type: "host-result",
				id: call.id,
				ok: true,
				value: call.payload,
			};
		case "test.fail":
			return {
				type: "host-result",
				id: call.id,
				ok: false,
				message: "native host detail: /Users/nobody/app.tsx:1",
			};
		default:
			return null;
	}
}
