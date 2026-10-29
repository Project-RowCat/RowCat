import type {
	NativeRuntimeErrorInfo,
	NativeRuntimeFailure,
	NativeRuntimeGeneration,
} from "./protocol.ts";

/**
 * The native runtime's state machine: one discriminated union, not several booleans.
 *
 * idle → starting → running → stopping → idle; `failed` is reachable from starting and running and
 * restarts through `start`.
 *
 * It mirrors the web preview's file. The one difference is that there is no compile stage here,
 * since the input is already an emitted artifact. In exchange, `failed` receives transport
 * failures.
 *
 * ## The generation is the gate
 *
 * A message with a different generation produces no transition. Restarts are frequent, so an old
 * session's `started`, `failed` or `stopped` can arrive on top of the new session's state.
 * Accepting one would make the screen claim a state that is not running.
 *
 * Only transport failure ignores the generation. A dead bridge is a fact about everything on it,
 * not about one session, so any session running on it dies too.
 */

export interface NativeRuntimeRootError {
	error: NativeRuntimeErrorInfo;
	work: "render" | "effects" | "event";
}

export type NativeRuntimeState =
	| { status: "idle" }
	/**
	 * The first commit arrives before `started`: the harness emits it inside `mountRoot`, and
	 * `started` goes out after that call returns. So this branch also carries a revision. Without it,
	 * the mounted tree is on screen while the state says 0.
	 */
	| {
			status: "starting";
			generation: NativeRuntimeGeneration;
			revision: number;
	  }
	| {
			status: "running";
			generation: NativeRuntimeGeneration;
			revision: number;
			/** The last render, effect or event failure. The previous commit stays on screen. */
			rootError: NativeRuntimeRootError | null;
			/**
			 * Remote image addresses this session authorizes. The asset resolver reads them.
			 *
			 * They live in state rather than a module global or coordinator field. A generation change then
			 * clears them automatically. Forgetting that clear in a global would let story A's declared
			 * address open in story B's session, with no visible symptom (the image still renders). Being
			 * present only in `running` is the same axis: before the session starts and after it dies, no
			 * address is authorized.
			 */
			remoteAssets: readonly string[];
	  }
	| { status: "stopping"; generation: NativeRuntimeGeneration }
	| {
			status: "failed";
			generation: NativeRuntimeGeneration | null;
			failure: NativeRuntimeFailure;
	  };

export type NativeRuntimeStatus = NativeRuntimeState["status"];

export type NativeRuntimeAction =
	| { type: "start"; generation: NativeRuntimeGeneration }
	| {
			type: "started";
			generation: NativeRuntimeGeneration;
			remoteAssets: readonly string[];
	  }
	| {
			type: "committed";
			generation: NativeRuntimeGeneration;
			revision: number;
	  }
	| {
			type: "rootError";
			generation: NativeRuntimeGeneration;
			error: NativeRuntimeErrorInfo;
			work: "render" | "effects" | "event";
	  }
	| {
			type: "failed";
			generation: NativeRuntimeGeneration;
			failure: NativeRuntimeFailure;
	  }
	| { type: "stop"; generation: NativeRuntimeGeneration }
	| { type: "stopped"; generation: NativeRuntimeGeneration }
	/** The bridge or renderer process died. Ignores the generation. */
	| { type: "transportFailed"; reason: string };

export const initialNativeRuntimeState: NativeRuntimeState = { status: "idle" };

const generationOf = (
	state: NativeRuntimeState,
): NativeRuntimeGeneration | null =>
	state.status === "idle"
		? null
		: state.status === "failed"
			? state.generation
			: state.generation;

export function nativeRuntimeReducer(
	state: NativeRuntimeState,
	action: NativeRuntimeAction,
): NativeRuntimeState {
	if (action.type === "start")
		return { status: "starting", generation: action.generation, revision: 0 };

	if (action.type === "transportFailed")
		return {
			status: "failed",
			generation: generationOf(state),
			failure: { stage: "transport", message: action.reason },
		};

	if (action.generation !== generationOf(state)) return state;

	switch (action.type) {
		case "started":
			return state.status === "starting"
				? {
						status: "running",
						generation: state.generation,
						/** Inherits the revision of commits that arrived while starting. */
						revision: state.revision,
						rootError: null,
						remoteAssets: action.remoteAssets,
					}
				: state;
		case "committed":
			/** A successful commit clears a prior render failure: the new render won. */
			if (state.status === "starting")
				return { ...state, revision: action.revision };
			return state.status === "running"
				? { ...state, revision: action.revision, rootError: null }
				: state;
		case "rootError":
			return state.status === "running"
				? { ...state, rootError: { error: action.error, work: action.work } }
				: state;
		case "failed":
			return {
				status: "failed",
				generation: action.generation,
				failure: action.failure,
			};
		case "stop":
			if (state.status === "idle" || state.status === "stopping") return state;
			if (state.status === "failed") return initialNativeRuntimeState;
			return { status: "stopping", generation: state.generation };
		case "stopped":
			return state.status === "stopping" ? initialNativeRuntimeState : state;
	}
}

/**
 * The controls the screen offers in each state.
 *
 * idle: start · starting: stop · running: restart, stop · stopping: none · failed: restart
 */
export interface NativeRuntimeControls {
	start: boolean;
	restart: boolean;
	stop: boolean;
}

export function nativeRuntimeControls(
	state: NativeRuntimeState,
): NativeRuntimeControls {
	switch (state.status) {
		case "idle":
			return { start: true, restart: false, stop: false };
		case "starting":
			return { start: false, restart: false, stop: true };
		case "running":
			return { start: false, restart: true, stop: true };
		case "stopping":
			return { start: false, restart: false, stop: false };
		case "failed":
			return { start: false, restart: true, stop: false };
	}
}
