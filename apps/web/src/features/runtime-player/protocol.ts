import type { RuntimeConsoleLevel } from "@rowcat/runtime-host/capabilities";
import type { RuntimeCommandBatch } from "@rowcat/runtime-host/commands";
import type { RuntimePatchBatch } from "@rowcat/runtime-host/patches";
import type { RuntimePersistentStateSnapshot } from "@rowcat/runtime-host/persistent-state";
import type { RuntimeStoryStateSnapshot } from "@rowcat/runtime-host/story-state";
import type { RuntimeWireValue } from "@rowcat/runtime-host/wire";
import type {
	PreviewErrorInfo,
	PreviewGenerationRequest,
	PreviewGenerationResult,
} from "#/features/runtime-preview/protocol.ts";

/**
 * The product playback worker protocol. It resembles the studio preview worker's, but the input
 * differs:
 *   preview:  source files -> worker compiles -> VM
 *   playback: artifact -> worker goes straight to VM
 * - With no source input there is no reason for the TypeScript compiler to be in this bundle
 *   (§50, §51). The saved snapshot comes from the main process's product store, not from worker
 *   memory (§56).
 * - Snapshot ownership splits. The preview worker holds its snapshot in memory, so it is lost on
 *   refresh, which is expected for an authoring tool. The playback main process holds it through
 *   `RuntimePlayerPersistence` -> Dexie -> E2EE sync. So `start` takes both snapshots. If the
 *   worker knew the store, this file would know Dexie, and the worker would become a storage layer
 *   rather than an isolation boundary.
 * - Generation vocabulary is shared with the preview. If request, result, and error shapes
 *   diverged, the trusted generation adapter would become two copies, and the leak closed in Phase
 *   6C (provider raw text reaching the VM with a named reason) would be closed on one side only.
 *   The three types are imported from the preview protocol. They are the vocabulary, not the UI.
 */

export type PlayerGeneration = number;

/**
 * Screen-facing projection of one error. Same shape as the preview's. Host paths and stack traces
 * are not included.
 */
export type PlayerErrorInfo = PreviewErrorInfo;
export type PlayerGenerationRequest = PreviewGenerationRequest;
export type PlayerGenerationResult = PreviewGenerationResult;

export type PlayerWorkerRequest =
	| {
			type: "start";
			generation: PlayerGeneration;
			/**
			 * The server-compiled artifact, as opaque JSON. The worker runs it through the runtime host's
			 * validation before executing it (§93). Server validation is the first line of defense and this
			 * is the second, so if one layer is bypassed the other still holds.
			 */
			artifact: unknown;
			storyState: RuntimeStoryStateSnapshot;
			persistentState: RuntimePersistentStateSnapshot;
			/**
			 * Whether `useGeneration()` can actually be called in this session. Fixed when the session
			 * starts (§117). The VM's capability table is not swapped while it runs, so a change in the
			 * user's choice takes effect from the next session. The screen states this.
			 */
			generationEnabled: boolean;
	  }
	| { type: "stop"; generation: PlayerGeneration }
	| {
			type: "event";
			generation: PlayerGeneration;
			handlerId: number;
			payload?: string | null;
			/** `media` for an event nobody pressed (a sound ending); the session refuses generation for it. Absent is an interaction. */
			source?: "media";
	  }
	| {
			type: "generation-result";
			generation: PlayerGeneration;
			requestId: number;
			result: PlayerGenerationResult;
	  };

/**
 * Failure categories. They separate the creator's failures from ours (§131).
 * - artifact: the downloaded artifact cannot run in this app. An app update may be the fix.
 * - start: the session could not be established (hydration, migration, compatibility).
 * - runtime: creator code killed the session.
 * - renderer: a patch could not be applied. A restart is required.
 * - worker: the worker itself died.
 * - persistence: the previous session's save could not finish, so the transition cannot be
 *   chained. Retrying the save is the fix. There is no compile category. This worker does not
 *   compile.
 */
export type PlayerFailure =
	| { stage: "artifact"; message: string; code: string | null }
	| { stage: "start"; error: PlayerErrorInfo }
	| { stage: "runtime"; error: PlayerErrorInfo }
	| { stage: "renderer"; message: string }
	| { stage: "worker"; message: string }
	/**
	 * Not the worker's. The main process lifecycle creates it. If a restart or reset cannot flush the
	 * old save through to the end, the session is not established and this failure remains (§Phase 7
	 * closing).
	 */
	| { stage: "persistence"; message: string };

export type PlayerWorkerMessage =
	| { type: "status"; generation: PlayerGeneration; stage: "starting" }
	/**
	 * The remote image origins this session is allowed to load, as declared by the validated artifact.
	 * They are sent before mount. The web renderer sets an image's `src` once, when the prop is first
	 * applied, and does not reset it if the list changes later. When this list arrived after the first
	 * commit, the first screen's remote images stayed as placeholders until their props changed.
	 *
	 * The main process does not read the list from the artifact itself. The worker that established
	 * the session did the validation, so the list it sends is authoritative. If the main process read
	 * it independently, a value that had not passed validation could become the basis for the
	 * resolver. The message carries the generation number, so the previous session's list cannot leak
	 * into a new one.
	 */
	| {
			type: "remote-assets";
			generation: PlayerGeneration;
			remoteAssets: readonly string[];
	  }
	| { type: "started"; generation: PlayerGeneration }
	| {
			type: "commit";
			generation: PlayerGeneration;
			batch: RuntimePatchBatch;
	  }
	/**
	 * One batch of control commands (scroll, focus). It arrives after the `commit` for the same
	 * generation. Order is this message's entire contract. The worker's `postMessage` preserves order
	 * and the main process handles messages in that order, so `scrollToEnd` measures after the commit
	 * that grew the list has reached the DOM.
	 */
	| {
			type: "commands";
			generation: PlayerGeneration;
			batch: RuntimeCommandBatch;
	  }
	| {
			type: "console";
			generation: PlayerGeneration;
			level: RuntimeConsoleLevel;
			args: RuntimeWireValue[];
	  }
	| {
			type: "root-error";
			generation: PlayerGeneration;
			error: PlayerErrorInfo;
			work: "render" | "effects" | "event";
	  }
	/**
	 * The canonical snapshot after hydration completes. It arrives before mount. If migration bumped
	 * the schema version, this is the current state. The main process passes it to
	 * `RuntimePlayerPersistence.sessionHydrated()` to make it durable (§59). Without that call, the
	 * next session would run the same migration again.
	 */
	| {
			type: "hydrated";
			generation: PlayerGeneration;
			storyState: RuntimeStoryStateSnapshot;
			persistentState: RuntimePersistentStateSnapshot;
	  }
	| {
			type: "story-state";
			generation: PlayerGeneration;
			snapshot: RuntimeStoryStateSnapshot;
	  }
	/**
	 * Committed persistent progress. It is a separate message from the playthrough state because the
	 * two have different lifecycles.
	 */
	| {
			type: "persistent-state";
			generation: PlayerGeneration;
			snapshot: RuntimePersistentStateSnapshot;
	  }
	| {
			type: "generation-request";
			generation: PlayerGeneration;
			requestId: number;
			request: PlayerGenerationRequest;
	  }
	| { type: "failed"; generation: PlayerGeneration; failure: PlayerFailure }
	| { type: "stopped"; generation: PlayerGeneration };
