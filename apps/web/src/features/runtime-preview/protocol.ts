import type { RuntimeDiagnostic } from "@rowcat/runtime-compiler/contracts";
import type { RuntimeConsoleLevel } from "@rowcat/runtime-host/capabilities";
import type { RuntimeCommandBatch } from "@rowcat/runtime-host/commands";
import type { RuntimePatchBatch } from "@rowcat/runtime-host/patches";
import type { RuntimePersistentStateSnapshot } from "@rowcat/runtime-host/persistent-state";
import type { RuntimeRootDiagnostic } from "@rowcat/runtime-host/session";
import type { RuntimeStoryStateSnapshot } from "@rowcat/runtime-host/story-state";
import type { RuntimeWireValue } from "@rowcat/runtime-host/wire";

/**
 * Everything exchanged between the preview worker and the main thread.
 *
 * - Main to worker: start, stop, event, reset-story, reset-persistent, generation-result. Worker
 *   to main: status, started, commit, console, diagnostic, root-error, failed, stopped,
 *   story-state, persistent-state, generation-request.
 * - Generation runs on the main thread; the worker only requests it. The worker holds no SDK
 *   client, credential store, or payment cache, and must not: those live in the main realm. The
 *   worker's side of useGeneration() is one round trip: generation-request goes to main, main runs
 *   the trusted RowCat stack (target resolution, managed settlement, BYO), and generation-result
 *   returns. The result settles the promise and re-enters the VM through the scheduler's completion
 *   queue.
 * - requestId exists because one generation can have several requests (one at a time, but several
 *   in sequence). The generation number separates restarts: a late answer from an old session
 *   carries a different number and does not reach the new one.
 * - Main issues a monotonically increasing generation number and the worker echoes it on every
 *   message; messages with another number are dropped. Order alone cannot separate sessions,
 *   because the worker is serial but main's state is already on the new session.
 * - Not sent back to main: compiled code, artifacts, source maps (they stay in the worker). DOM
 *   event objects never go to the worker; a handler id is all it gets. VM objects cross in neither
 *   direction. Everything on the wire is JSON.
 * - Save snapshots are owned by the worker, since the session starts and dies there. Main
 *   receives a copy only to draw it. No snapshot goes the other way: if main could edit save state,
 *   those edits would skip creator code, and the studio would become a second author of the save
 *   format.
 */

export type PreviewGeneration = number;

export interface PreviewSourceFile {
	path: string;
	content: string;
}

export type PreviewWorkerRequest =
	| {
			type: "start";
			generation: PreviewGeneration;
			entry: string;
			files: PreviewSourceFile[];
			/** If true, the playthrough snapshot is cleared before the session starts (`Reset play`). */
			resetStory?: boolean;
			/**
			 * Separate from resetStory, which is the whole point of this slice. Folding them together would
			 * make a playthrough reset erase unlocks from several playthroughs, the opposite of why this
			 * save lifetime exists.
			 */
			resetPersistent?: boolean;
			/**
			 * Defaults to false (§36). Enabling the preview must not create a state that can send paid
			 * generation requests; the creator opts in explicitly in the studio. When off, the capability is
			 * absent from the table and generate() fails with runtime_generation_unavailable.
			 */
			generationEnabled?: boolean;
	  }
	| { type: "stop"; generation: PreviewGeneration }
	| {
			type: "event";
			generation: PreviewGeneration;
			handlerId: number;
			/**
			 * The string carried by a text input. Absent for a press; that slot is a call with no argument.
			 */
			payload?: string | null;
			/** `media` for an event nobody pressed (a sound ending); the session refuses generation for it. Absent is an interaction. */
			source?: "media";
	  }
	| {
			type: "generation-result";
			generation: PreviewGeneration;
			requestId: number;
			result: PreviewGenerationResult;
	  }
	/**
	 * Playthrough reset for when no session is running. While one is running, reset is done by `start`
	 * carrying resetStory, so starting a new session and clearing the snapshot are one operation. This
	 * request clears a stopped preview's snapshot so the next run starts from the beginning.
	 */
	| { type: "reset-story"; generation: PreviewGeneration }
	/**
	 * For creators and debugging only. It clears only preview memory; the product playback surface has
	 * no such action. It exists for testing: reproducing a first-time user's screen requires clearing
	 * long progress too. Without it, creators would learn to reload the browser instead.
	 */
	| { type: "reset-persistent"; generation: PreviewGeneration }
	/**
	 * Main has handled every commit up to this revision. Backpressure: the worker's scheduler does not
	 * start another slice while too many commits are unanswered (lib/runtime-watchdog/commit-flow.ts).
	 */
	| { type: "ack"; generation: PreviewGeneration; revision: number }
	/**
	 * Liveness: answered from the worker's message handler, which runs only between VM turns
	 * (lib/runtime-watchdog/liveness.ts). Sent only while a session runs, never during the compile.
	 */
	| { type: "ping"; generation: PreviewGeneration; seq: number };

/**
 * The on-screen projection of an error. Host file paths, worker stacks, and engine internals are
 * not carried here. Creators need the sentence, the runtime code, and the component chain.
 */
export interface PreviewErrorInfo {
	/** `creator`: the creator's code threw. `host`: the host, the VM, or a resource limit failed. */
	kind: "creator" | "host";
	name: string;
	message: string;
	/**
	 * A runtime code such as `runtime_hook_order_changed`, or a host error code. Absent for plain
	 * exceptions.
	 */
	code: string | null;
	componentStack: string[];
	/**
	 * The creator's stack in source coordinates, creator files only.
	 *
	 * The worker maps frames back through source maps (runtime-preview-frames.ts). Host internals,
	 * engine internals, and worker frames never appear here. Frames that cannot be mapped back have
	 * null line and column; emitted line numbers are not presented as if they came from the source.
	 * Absent for host errors (kind: host).
	 */
	frames: PreviewErrorFrame[];
}

/** One line of the creator's stack. Pressing it jumps to that place in that file. */
export interface PreviewErrorFrame {
	/** The artifact's module id, which is the creator's file path (src/main.tsx). */
	path: string;
	functionName: string | null;
	/** Line and column in the source, 1-based. null if the position could not be mapped back. */
	line: number | null;
	column: number | null;
}

/**
 * One generation request. It holds what the creator wrote and what the host validated.
 *
 * The shape has no provider, model, key, or balance. The trusted main-thread stack decides those,
 * and the worker never learns the decision; it only receives the result.
 */
export interface PreviewGenerationRequest {
	messages: { role: "user" | "assistant"; content: string }[];
	instructions: string;
	maxOutputCharacters: number;
}

/**
 * The result is either one text or one named reason. The provider's raw error is not carried here.
 */
export type PreviewGenerationResult =
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

export type PreviewFailure =
	| { stage: "compile"; diagnostics: RuntimeDiagnostic[] }
	| { stage: "start"; error: PreviewErrorInfo }
	| { stage: "runtime"; error: PreviewErrorInfo }
	| { stage: "renderer"; message: string }
	| { stage: "worker"; message: string };

export type PreviewWorkerMessage =
	| {
			type: "status";
			generation: PreviewGeneration;
			stage: "compiling" | "starting";
	  }
	/**
	 * The remote image addresses this session authorizes, declared by the verified artifact. They must
	 * arrive before mount. The web renderer decides an image's src once, when the prop attaches, and
	 * does not revisit it when the list changes. When the list arrived with `started` after the first
	 * commit, a first screen's remote images stayed placeholders until that prop changed.
	 *
	 * Main does not extract the list from the artifact itself. The worker validated the session, and
	 * that validation is the authority; if main read the artifact separately, unvalidated values would
	 * become the resolver's basis. The list is carried with the generation, so a previous session's
	 * list cannot persist into the next.
	 */
	| {
			type: "remote-assets";
			generation: PreviewGeneration;
			remoteAssets: readonly string[];
	  }
	| {
			type: "started";
			generation: PreviewGeneration;
			remoteAssets: readonly string[];
	  }
	| {
			type: "commit";
			generation: PreviewGeneration;
			batch: RuntimePatchBatch;
	  }
	/**
	 * A batch of control commands (scroll, focus). It always follows the `commit` it belongs to. Order
	 * is this message's whole contract. The worker's postMessage keeps order and main processes in
	 * that order, so a scrollToEnd measures after the commit that grew the list has reached the DOM.
	 */
	| {
			type: "commands";
			generation: PreviewGeneration;
			batch: RuntimeCommandBatch;
	  }
	| {
			type: "console";
			generation: PreviewGeneration;
			level: RuntimeConsoleLevel;
			args: RuntimeWireValue[];
	  }
	| {
			type: "diagnostic";
			generation: PreviewGeneration;
			diagnostic: RuntimeRootDiagnostic;
	  }
	| {
			type: "root-error";
			generation: PreviewGeneration;
			error: PreviewErrorInfo;
			work: "render" | "effects" | "event";
	  }
	/**
	 * The current save snapshot, sent after hydration, after every commit, and after a reset. It is
	 * the full state, not a delta, because the screen draws the current state. A delta protocol would
	 * make main a second store that folds the deltas, and that store would diverge whenever the
	 * generation changed.
	 */
	| {
			type: "story-state";
			generation: PreviewGeneration;
			snapshot: RuntimeStoryStateSnapshot;
	  }
	/**
	 * The current persistent snapshot. It is a separate message from the playthrough snapshot, so the
	 * screen draws the two in separate sections.
	 */
	| {
			type: "persistent-state";
			generation: PreviewGeneration;
			snapshot: RuntimePersistentStateSnapshot;
	  }
	| {
			type: "generation-request";
			generation: PreviewGeneration;
			requestId: number;
			request: PreviewGenerationRequest;
	  }
	| { type: "failed"; generation: PreviewGeneration; failure: PreviewFailure }
	| { type: "stopped"; generation: PreviewGeneration; cleanups: number }
	/** The answer to `ping`, carrying its number. Not an observation event: the debugger never sees it. */
	| { type: "pong"; generation: PreviewGeneration; seq: number };
