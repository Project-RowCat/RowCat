/**
 * Runtime execution phase: where creator code is running right now.
 *
 * - idle: creator code is not running.
 * - render: inside a component function. Only hooks are allowed. State setters, effects and host
 *   calls are rejected.
 * - commit: the reconciler builds the patch. Creator code does not run.
 * - event: inside a handler for a host event.
 * - effect and cleanup: inside a committed effect or its cleanup function.
 *
 * The phase enforces render purity as a value. A setState during render seeds an infinite re-render
 * loop. React tolerates that loop by design, but there is no reason to follow it. A host capability
 * call during render would go out again for every render of the same tree.
 *
 * No capability exists yet. The axis comes first so the check becomes one line when capabilities
 * arrive.
 *
 * Not exported. If creators start branching on phase(), that becomes a contract.
 */

export type RuntimeExecutionPhase =
	| "idle"
	| "render"
	| "commit"
	| "event"
	| "effect"
	| "cleanup";

let current: RuntimeExecutionPhase = "idle";

export function runtimePhase(): RuntimeExecutionPhase {
	return current;
}

/**
 * Sets the phase, runs one function, and always restores the phase. The try/finally is the whole
 * function.
 *
 * If creator code throws and the phase stays set, the next render is rejected as already rendering.
 * The state would not recover until the session is rebuilt.
 */
export function withRuntimePhase<T>(
	phase: RuntimeExecutionPhase,
	body: () => T,
): T {
	const previous = current;
	current = phase;
	try {
		return body();
	} finally {
		current = previous;
	}
}
