/**
 * The session state machine, as one value instead of four booleans. Separate isReady, isRunning,
 * isDisposed, and hasFailed flags allow combinations like isRunning && isDisposed, and nothing says
 * what to do with them. With one value, those combinations cannot exist.
 *
 * Failed means the VM state can no longer be trusted (memory limit, budget overrun, engine error).
 * The only exit from failed is disposing, and there is no transition back to ready. That is what
 * keeps a failed VM from ever being re-entered.
 */

export type RuntimeSessionState =
	| "creating"
	| "ready"
	| "running"
	| "disposing"
	| "disposed"
	| "failed";

const TRANSITIONS: Readonly<
	Record<RuntimeSessionState, readonly RuntimeSessionState[]>
> = {
	creating: ["ready", "failed", "disposing"],
	ready: ["running", "failed", "disposing"],
	running: ["ready", "failed", "disposing"],
	failed: ["disposing"],
	disposing: ["disposed"],
	disposed: [],
};

export const canTransition = (
	from: RuntimeSessionState,
	to: RuntimeSessionState,
): boolean => TRANSITIONS[from].includes(to);

/** An invalid transition is not ignored silently. Throwing here means a bug in the host. */
export function transition(
	from: RuntimeSessionState,
	to: RuntimeSessionState,
): RuntimeSessionState {
	if (!canTransition(from, to))
		throw new Error(`invalid runtime session transition: ${from} → ${to}`);
	return to;
}
