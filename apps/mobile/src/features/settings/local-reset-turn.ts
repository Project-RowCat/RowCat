import type { MobileLocalScopeStatus } from "../../lib/local-data/scope.tsx";

/**
 * The single-run lifetime of a local reset: when to lock and when to unlock.
 *
 * This is a pure module because this app's tests do not render screens. If the decision lived
 * inside a component, the only way to check it would be trying it by hand, and both symptoms of
 * getting it wrong are silent:
 *
 * ```text
 * unlocks too late    after a successful reset, the same screen can never erase again (permanent lock)
 * unlocks too early   the data is erased and the same operation starts again in the window before a new scope exists
 * ```
 *
 * ## Why `finally { runningRef.current = false }` is not the answer
 *
 * The moment physical deletion finishes is **different from** the moment the **same member's new
 * scope opens**. In between there is no data and no open connection; a second reset arriving then
 * would queue reactivation and the next deletion side by side in the controller's serial queue. The
 * symptoms of that race do not reproduce.
 *
 * So the lock is released on an **observed fact**: this member now owns a scope of a **new
 * instance**. Judging by member id is the point of avoiding — the id is the same before and after
 * the reset, so that comparison is always true and guards nothing (the same axis as `ownsScope`,
 * which looks at the instance).
 */

/** The value captured when a reset starts: what it will be compared against. */
export interface LocalResetAwaiting {
	/** The member this operation targets. Compared with the screen's current member. */
	viewerId: string;
	/**
	 * The scope instance at the start. May be `null` (still opening, or never opened).
	 *
	 * Holding the instance directly is all this field does. Only the **reference is compared**;
	 * nothing is done with the object, so no store or connection leaks through here.
	 */
	previousScope: object | null;
}

/** The scope state the screen sees now: the thing compared against. */
export interface LocalResetObservation {
	viewerId: string | null;
	status: MobileLocalScopeStatus;
	scope: object | null;
}

/**
 * Whether this operation has **finished**: whether the lock may be released.
 *
 * Three branches become true, and all three mean there is no reason to wait for this operation any
 * longer:
 *
 * ```text
 * the member changed        this screen no longer owns that operation (the tree is about to unmount)
 * could not reopen          the scope is `error`; keeping the lock would leave the user unable even to retry
 * a new scope opened        the normal path: **same member, different instance**
 * ```
 *
 * Dropping the middle branch would kill this button permanently on a device where opening failed
 * once. Pressing it again is safe in that state because physical deletion is idempotent: deleting a
 * nonexistent file and key counts as success (`lib/local-data/purge.ts`).
 */
export function localResetSettled(
	awaiting: LocalResetAwaiting,
	observation: LocalResetObservation,
): boolean {
	if (observation.viewerId !== awaiting.viewerId) return true;
	if (observation.status === "error") return true;
	return (
		observation.status === "ready" &&
		observation.scope !== null &&
		observation.scope !== awaiting.previousScope
	);
}
