import type { RuntimeVmFailure } from "../vm/types.ts";

/**
 * The weight of a failure: whether the VM must be discarded, or only one job should be rejected.
 *
 * - fatal: interrupted (budget or cancellation), memory, engine. The VM is left in an
 *   intermediate state with the creator's invariants broken, so it is never re-entered.
 * - recoverable: thrown (a creator exception, or a host rejection carrying host code) and lookup.
 *   The VM is intact. Only that job is rejected, and the next job runs as usual.
 *
 * Phase 4B builds on this split. An exception in an event handler loses only that event, and an
 * exception in an effect loses only that effect. A memory limit ends the whole session. If the
 * scheduler did not know this, a creator exception could kill the session (too heavy), or the VM
 * could be re-entered after a memory limit (too light).
 */

export type RuntimeFailureSeverity = "fatal" | "recoverable";

export function failureSeverity(
	failure: RuntimeVmFailure,
): RuntimeFailureSeverity {
	switch (failure.kind) {
		case "interrupted":
		case "memory":
		case "engine":
			return "fatal";
		case "thrown":
		case "lookup":
			return "recoverable";
	}
}
