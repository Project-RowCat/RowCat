import type { PlayerErrorInfo, PlayerFailure } from "./protocol.ts";

/**
 * The playback screen's state machine: one pure reducer, not conditions scattered through
 * components.
 * - It distinguishes eight states (§131). Four require different user actions, so folding any of
 *   them together would make users retry when they should wait, or distrust their connection when
 *   they should update the app.
 * - loading: fetching the playback response. syncing: no local save and the first sync is not
 *   done; this is not a new game. starting: VM booting. running: live.
 * - creator-error: creator code threw. The previous screen stays, because a failed render commits
 *   nothing and the old tree still matches the host (§132).
 * - incompatible: this app cannot run the artifact, so the answer is an app update. failed: our
 *   side broke (host, worker or renderer), so only a restart helps. unavailable: not entitled or
 *   the server refused, and an outside path answers it.
 */
export type RuntimePlayerStatus =
	| "loading"
	| "syncing"
	| "starting"
	| "running"
	| "creator-error"
	| "incompatible"
	| "failed"
	| "unavailable";

export interface RuntimePlayerState {
	status: RuntimePlayerStatus;
	/**
	 * Current generation. It increments on every restart, so messages from older generations reach
	 * nothing.
	 */
	generation: number;
	/** Last error thrown by creator code. Set only in `creator-error`. */
	creatorError: PlayerErrorInfo | null;
	/** Our-side failure. Set only in `incompatible` and `failed`. */
	failure: PlayerFailure | null;
}

export const initialRuntimePlayerState: RuntimePlayerState = {
	status: "loading",
	generation: 0,
	creatorError: null,
	failure: null,
};

export type RuntimePlayerAction =
	/**
	 * Dispatched when the save is being read, it is absent locally, and the first sync has not
	 * finished.
	 */
	| { type: "sync-required" }
	/**
	 * Starts a new generation. Restart, `Reset play` (reset) and first run all go through this single
	 * action.
	 */
	| { type: "start"; generation: number }
	| { type: "started"; generation: number }
	| { type: "root-error"; generation: number; error: PlayerErrorInfo }
	| { type: "failed"; generation: number; failure: PlayerFailure }
	/** Entitlement, network or contract failure: the playback response itself was not received. */
	| { type: "unavailable" };

export function runtimePlayerReducer(
	state: RuntimePlayerState,
	action: RuntimePlayerAction,
): RuntimePlayerState {
	switch (action.type) {
		case "sync-required":
			/**
			 * When a transition begins, the screen is already `starting`, because the lifecycle notifies
			 * before it stops the old owner. If the following `load()` answers that it must wait for the
			 * first sync, the screen moves to `syncing` right there. Accepting that answer only from
			 * `loading` would leave a restarted screen stuck at `starting` forever.
			 */
			return state.status === "loading" || state.status === "starting"
				? { ...state, status: "syncing" }
				: state;
		case "start":
			return {
				status: "starting",
				generation: action.generation,
				creatorError: null,
				failure: null,
			};
		case "started":
			/**
			 * Drops messages from an old generation. If A starts, restart brings up B, and then A's
			 * `started` arrives, the screen would go wrong without any error.
			 */
			if (action.generation !== state.generation) return state;
			return { ...state, status: "running", creatorError: null };
		case "root-error":
			if (action.generation !== state.generation) return state;
			/**
			 * If the session died, the worker sends `failed` separately. A failure arriving here lost only
			 * that one task, so the screen stays and only the error is added.
			 */
			return { ...state, status: "creator-error", creatorError: action.error };
		case "failed":
			if (action.generation !== state.generation) return state;
			return {
				...state,
				status: action.failure.stage === "artifact" ? "incompatible" : "failed",
				failure: action.failure,
			};
		case "unavailable":
			return { ...state, status: "unavailable" };
	}
}

/**
 * Whether the creator's screen may be drawn now. It is true in `creator-error` too, because the
 * previous tree still matches the host. It is false in `failed` and `incompatible`: there the host
 * and screen no longer share a tree, or the session never started.
 */
export const showsRuntimeSurface = (state: RuntimePlayerState): boolean =>
	state.status === "running" || state.status === "creator-error";
