import type {
	PreviewErrorInfo,
	PreviewFailure,
	PreviewGeneration,
} from "./protocol.ts";

/**
 * Preview state machine: one tagged union instead of several booleans, so impossible combinations
 * (running while stopping, failed while stale) cannot be expressed. The main path is idle,
 * compiling, starting, running, stopping, idle. Failure is reachable from each active stage.
 *
 * A message from an old generation (a session since replaced) makes no transition. Restarts are
 * frequent, and a late `started` or `failed` from the old session would otherwise land on the new
 * one and claim it runs.
 *
 * Staleness is a fact, not an operation. A running VM cannot take new code (hot state transfer is
 * not implemented), so the state records that the screen runs the previous code. The creator
 * restarts to apply the change.
 */

export interface PreviewRootError {
	error: PreviewErrorInfo;
	work: "render" | "effects" | "event";
}

export type RuntimePreviewState =
	| { status: "idle" }
	| { status: "compiling"; generation: PreviewGeneration; signature: string }
	| { status: "starting"; generation: PreviewGeneration; signature: string }
	| {
			status: "running";
			generation: PreviewGeneration;
			signature: string;
			stale: boolean;
			revision: number;
			/** Error from the last render, effect or event. The previous commit stays on screen. */
			rootError: PreviewRootError | null;
	  }
	| { status: "stopping"; generation: PreviewGeneration }
	| {
			status: "failed";
			generation: PreviewGeneration;
			failure: PreviewFailure;
	  };

export type RuntimePreviewStatus = RuntimePreviewState["status"];

export type RuntimePreviewAction =
	| { type: "run"; generation: PreviewGeneration; signature: string }
	| { type: "starting"; generation: PreviewGeneration }
	/**
	 * `signature` is the editor's signal at the moment the session is set up, not the run snapshot's.
	 * The creator keeps typing during compile and start, and those `sourceChanged` actions make no
	 * transition because no session runs yet. The transition that starts the session therefore takes
	 * that difference directly. If an effect compared later, the first frame would show old code as
	 * the latest.
	 */
	| { type: "started"; generation: PreviewGeneration; signature: string }
	| { type: "committed"; generation: PreviewGeneration; revision: number }
	| {
			type: "rootError";
			generation: PreviewGeneration;
			error: PreviewErrorInfo;
			work: "render" | "effects" | "event";
	  }
	| { type: "failed"; generation: PreviewGeneration; failure: PreviewFailure }
	| { type: "stop"; generation: PreviewGeneration }
	| { type: "stopped"; generation: PreviewGeneration }
	| { type: "sourceChanged"; signature: string };

export const initialRuntimePreviewState: RuntimePreviewState = {
	status: "idle",
};

const generationOf = (state: RuntimePreviewState): PreviewGeneration | null =>
	state.status === "idle" ? null : state.generation;

export function runtimePreviewReducer(
	state: RuntimePreviewState,
	action: RuntimePreviewAction,
): RuntimePreviewState {
	if (action.type === "run")
		return {
			status: "compiling",
			generation: action.generation,
			signature: action.signature,
		};

	if (action.type === "sourceChanged") {
		if (state.status !== "running") return state;
		const stale = action.signature !== state.signature;
		return stale === state.stale ? state : { ...state, stale };
	}

	/** A different generation means no transition: the message is news from an old session. */
	if (action.generation !== generationOf(state)) return state;

	switch (action.type) {
		case "starting":
			return state.status === "compiling"
				? { ...state, status: "starting" }
				: state;
		case "started":
			return state.status === "starting"
				? {
						status: "running",
						generation: state.generation,
						signature: state.signature,
						/** If the source changed while the session was starting, it is stale from its first frame. */
						stale: action.signature !== state.signature,
						revision: 0,
						rootError: null,
					}
				: state;
		case "committed":
			/** A successful commit clears an earlier render failure, since the new render has won. */
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
			if (state.status === "failed") return initialRuntimePreviewState;
			return { status: "stopping", generation: state.generation };
		case "stopped":
			return state.status === "stopping" ? initialRuntimePreviewState : state;
	}
}

/**
 * Lists which controls each state offers. Stop is also available while compiling, so compilation
 * can be cancelled. While running and stale, restart comes first.
 */
export interface RuntimePreviewControls {
	run: boolean;
	restart: boolean;
	stop: boolean;
}

/**
 * What playthrough reset does depends on one state.
 * - `restart-fresh`: a session is running. The snapshot is cleared and a new session is set up,
 *   as one action.
 * - `clear-only`: no session is running. Only the snapshot is cleared; the next run starts from
 *   the beginning.
 *
 * The decision lives outside the hook because it is a distinct fact from restart. If reset and
 * restart silently became the same, the difference would be invisible on screen. The cost of such a
 * change is a creator who restarted to change a response losing their progress.
 */
export type RuntimePreviewResetPlan = "restart-fresh" | "clear-only";

export function runtimePreviewResetPlan(
	state: RuntimePreviewState,
): RuntimePreviewResetPlan {
	return state.status === "idle" || state.status === "failed"
		? "clear-only"
		: "restart-fresh";
}

export function runtimePreviewControls(
	state: RuntimePreviewState,
): RuntimePreviewControls {
	switch (state.status) {
		case "idle":
			return { run: true, restart: false, stop: false };
		case "compiling":
		case "starting":
			return { run: false, restart: false, stop: true };
		case "running":
			return { run: false, restart: true, stop: true };
		case "stopping":
			return { run: false, restart: false, stop: false };
		case "failed":
			return { run: false, restart: true, stop: false };
	}
}
