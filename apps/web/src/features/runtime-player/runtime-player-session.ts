import type { RuntimePlayerLifecycleEvent } from "@rowcat/runtime-persistence";
import {
	RUNTIME_UNRESPONSIVE_CODE,
	RUNTIME_UNRESPONSIVE_MESSAGE,
} from "#/lib/runtime-watchdog/liveness.ts";
import type { PlayerFailure } from "./protocol.ts";

/**
 * Session rules the playback hook reads. They live here, as values, because the hook needs React
 * and a worker and this app's tests run neither (vitest.config.ts); a rule kept inline in the hook
 * would be checked by nothing.
 */

/**
 * Whether a generation request from `generation` may still reach the adapter.
 *
 * Both halves are needed. The session half alone stayed true for the retiring owner from the moment
 * a transition began until release(), which comes after the stop and the save flush: a request that
 * worker posted in that window started a paid call with a fresh AbortController that nothing would
 * abort, for a promise the worker had already rejected. The visible half is the same check the
 * commit, command and remote-asset branches already make.
 */
export function runtimePlayerAnswersGeneration(
	owner: { session: number | null; visible: number },
	generation: number,
): boolean {
	return owner.session === generation && owner.visible === generation;
}

/**
 * Which lifecycle events end the previous session's sound.
 *
 * The surface stays mounted through all of them (hidden, or behind a failure notice) and CSS
 * visibility does not pause a media element. The old session's unmount commit, which would have
 * removed its `<audio>`, is dropped once the visible generation moves on, and reset() runs only when
 * the next session actually starts. So without this, looped music played on under `syncing` or a
 * failure screen for as long as the person stayed.
 *
 * `started` belongs to the new session and `idle` comes after the surface is gone. A Record so that
 * a new event type stops compilation here until someone decides.
 */
export const LIFECYCLE_EVENT_SILENCES_AUDIO: Record<
	RuntimePlayerLifecycleEvent["type"],
	boolean
> = {
	transition: true,
	"sync-required": true,
	"load-failed": true,
	blocked: true,
	"start-failed": true,
	started: false,
	idle: false,
};

/**
 * The failure drawn when the liveness watchdog terminated the worker. It carries the budget code: to
 * the person, a work that ran past its time is one fact however it got there. The sentence is for the
 * console and diagnostics; the playback screen draws its own copy for runtime failures.
 */
export const runtimePlayerUnresponsiveFailure = (): PlayerFailure => ({
	stage: "runtime",
	error: {
		kind: "host",
		name: "RuntimeHostError",
		message: RUNTIME_UNRESPONSIVE_MESSAGE,
		code: RUNTIME_UNRESPONSIVE_CODE,
		componentStack: [],
		frames: [],
	},
});
