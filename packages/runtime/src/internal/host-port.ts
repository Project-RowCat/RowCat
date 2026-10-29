import { RUNTIME_ERROR_CODE, RuntimeError } from "./errors.ts";

/**
 * The only outbound channel from the runtime to the host. The runtime does not know the other side.
 *
 * - Not a capability call: capability calls are requested by the creator and return a promise.
 *   Patch batches are infrastructure output whose answer is accepted or not, and that answer must
 *   be synchronous. If it came after a promise, the next render could start before the commit
 *   decision.
 * - Not one call per operation: each native WebView bridge round trip takes milliseconds. One
 *   commit is one message.
 * - The port is installed by the host's internal module rowcat:internal/host-port-installer,
 *   which belongs to the host, not this package. The runtime never imports rowcat:internal/host.
 * - A commit that reaches an uninstalled port throws. Silently dropping it would render a blank
 *   screen as success.
 */

export type RuntimeHostPortDecision =
	| { ok: true }
	| { ok: false; code: string; message: string };

export interface RuntimeHostPort {
	/**
	 * Sends one JSON string on one channel. The call is synchronous, and the host's acceptance is the
	 * answer.
	 *
	 * The runtime serializes because it knows the shape of the outgoing value. The port carries a
	 * string, and the channel name says what the string is.
	 */
	emit(channel: string, json: string): RuntimeHostPortDecision;
}

let port: RuntimeHostPort | null = null;

/** Called only by the host's install module. Passing null removes the port; tests use this. */
export function setRuntimeHostPort(
	next: RuntimeHostPort | null,
): RuntimeHostPort | null {
	const previous = port;
	port = next;
	return previous;
}

export function hasRuntimeHostPort(): boolean {
	return port !== null;
}

export function runtimeHostPort(): RuntimeHostPort {
	if (port === null)
		throw new RuntimeError(
			RUNTIME_ERROR_CODE.hostPortMissing,
			"The runtime host port is not installed. Check the host's boot order.",
		);
	return port;
}
