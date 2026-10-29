import { RUNTIME_ERROR_CODE, RuntimeError } from "./errors.ts";

/**
 * Slot for calling host capabilities. The runtime does not know what is on the other side.
 *
 * - A capability is requested by the creator and returns a promise. The result arrives in a later
 *   turn through the scheduler's completion queue.
 * - Kept apart from host-port.ts so that an async branch on emit cannot push the commit
 *   accept/reject decision behind a promise.
 * - Filled by the host-installed module rowcat:internal/host-port-installer. The runtime never
 *   imports rowcat:internal/host.
 * - If called before installation it throws deterministically. Returning null would look like the
 *   model did not answer.
 * - Not exported from index.ts, and the compiler allowlist blocks rowcat:internal/*. Each
 *   capability exposes one narrow public API (useGeneration). A string-keyed call would make the
 *   capability table the creator API.
 */

export type RuntimeHostCapabilityCall = (
	capability: string,
	payload: unknown,
) => Promise<unknown>;

let call: RuntimeHostCapabilityCall | null = null;

/**
 * Called only by the host's install module. Passing null removes the capability; tests use this.
 */
export function setRuntimeHostCapability(
	next: RuntimeHostCapabilityCall | null,
): RuntimeHostCapabilityCall | null {
	const previous = call;
	call = next;
	return previous;
}

export function hasRuntimeHostCapability(): boolean {
	return call !== null;
}

export function runtimeHostCapability(): RuntimeHostCapabilityCall {
	if (call === null)
		throw new RuntimeError(
			RUNTIME_ERROR_CODE.hostPortMissing,
			"The runtime host capability is not installed. Check the host's boot order.",
		);
	return call;
}
