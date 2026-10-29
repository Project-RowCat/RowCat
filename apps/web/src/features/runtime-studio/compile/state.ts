import type {
	RuntimeAnalyzeResult,
	RuntimeDiagnostic,
} from "@rowcat/runtime-compiler";

/**
 * Pure state machine for compilation, so the race rule can be checked as a value without rendering.
 *
 * Rule: a compile that finishes late must not overwrite the latest result. Edits are fast and
 * requests overlap, so an older result can arrive after a newer one. Overwriting would keep drawing
 * an error the user already fixed. That symptom vanishes on the next keystroke, so it cannot be
 * reproduced. Results therefore carry a request number, and stale numbers are dropped silently.
 *
 * This state covers only the runtime analysis. The screen's inspection status is not this value,
 * because the reducer does not know Monaco's type diagnostics. Answering eligibility from this half
 * alone would draw `No problems` for projects with TypeScript errors, which did happen.
 * `runtime-compile-view.ts` merges both inputs and is the only source of what the screen shows.
 */

export const RUNTIME_COMPILE_STATUS = {
	idle: "idle",
	checking: "checking",
	ready: "ready",
	problems: "problems",
	/** The compiler itself failed. This is not something the creator can fix. */
	failed: "failed",
} as const;

export type RuntimeCompileStatus =
	(typeof RUNTIME_COMPILE_STATUS)[keyof typeof RUNTIME_COMPILE_STATUS];

export interface RuntimeCompileState {
	status: RuntimeCompileStatus;
	diagnostics: readonly RuntimeDiagnostic[];
	/** Modules reachable from the entry point. The `Runtime` cell draws this fact. */
	modules: readonly string[];
	requested: number;
	settled: number;
}

export const initialRuntimeCompileState: RuntimeCompileState = {
	status: RUNTIME_COMPILE_STATUS.idle,
	diagnostics: [],
	modules: [],
	requested: 0,
	settled: 0,
};

export type RuntimeCompileAction =
	| { type: "start"; requestId: number }
	| { type: "settle"; requestId: number; result: RuntimeAnalyzeResult }
	| { type: "fail"; requestId: number; diagnostic: RuntimeDiagnostic }
	| { type: "reset" };

export function runtimeCompileReducer(
	state: RuntimeCompileState,
	action: RuntimeCompileAction,
): RuntimeCompileState {
	switch (action.type) {
		case "reset":
			return initialRuntimeCompileState;

		case "start":
			/**
			 * Start only moves the request number forward. If it could move backwards, a cancelled request
			 * could make the next result stale.
			 */
			if (action.requestId <= state.requested) return state;
			return {
				...state,
				status: RUNTIME_COMPILE_STATUS.checking,
				requested: action.requestId,
			};

		case "settle":
			if (isStale(state, action.requestId)) return state;
			return {
				...state,
				status:
					action.result.diagnostics.length > 0
						? RUNTIME_COMPILE_STATUS.problems
						: RUNTIME_COMPILE_STATUS.ready,
				diagnostics: action.result.diagnostics,
				modules: action.result.modules,
				settled: action.requestId,
			};

		case "fail":
			if (isStale(state, action.requestId)) return state;
			return {
				...state,
				status: RUNTIME_COMPILE_STATUS.failed,
				diagnostics: [action.diagnostic],
				modules: [],
				settled: action.requestId,
			};
	}
}

/**
 * Whether a result is stale. Both axes are checked.
 *
 * Below `settled` means a newer result is already drawn. Above `requested` means a request that was
 * never started. That cannot happen through the state machine, so such a value is not accepted.
 */
const isStale = (state: RuntimeCompileState, requestId: number): boolean =>
	requestId < state.settled || requestId > state.requested;
