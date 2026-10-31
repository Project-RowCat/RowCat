import type { RuntimeHostSchedulerClock } from "@rowcat/runtime-host/scheduler/clock";

/**
 * Backpressure between a runtime worker and the main thread that applies its commits.
 *
 * - Why: the VM budget counts VM time only. Applying a batch happens afterwards, on the main thread
 *   that also runs the trusted shell, and nothing told the worker to wait. A work whose commits are
 *   cheap to emit and expensive to apply (a wide keyed reorder every render) could queue batches of up
 *   to 4 MiB on main faster than main drained them, freezing the tab while the VM stayed inside its
 *   budget.
 * - How: main acknowledges each commit revision once it has handled it. The scheduler's yield — the
 *   one point between slices where the host gets control back — does not return while more than
 *   `maxUnacknowledged` commits are unanswered. The VM is idle while it waits, so the wait costs no
 *   budget and the worker still answers messages (stop, events, liveness pings).
 * - The bound is per slice boundary, not per commit: a slice may run up to `maxTurnsPerSlice` turns
 *   before it yields, so a drain that keeps finding work holds at most `maxUnacknowledged` plus one
 *   slice's commits in flight. That is a fixed number, which is what turns an unbounded queue into a
 *   bounded one.
 * - A drain that empties its queue ends without yielding, and the scheduler starts the next one
 *   (on the next enqueue) without asking this clock. So the yield alone bounds one continuous
 *   drain, not the session: every press would start an ungated slice. Wakes that come from main —
 *   events and generation replies — therefore go through `admit()`, which holds them in order while
 *   the gate is shut. A held wake enqueues nothing, so no drain starts. What is still not gated is a
 *   drain restarted by a completion that settles inside the worker without main (a capability the
 *   host refuses at once); each such restart is one slice, counted by the session's host-call
 *   limits. Gating that too would need a hook where the scheduler starts a drain, which it does not
 *   offer.
 * - release() opens the gate for good, and runs every held wake. Stopping or disposing a session waits for the scheduler to go
 *   idle, and a drain parked here would never get there, so every path that ends a session releases
 *   first. Main stops acknowledging the moment a transition begins, so without the release the stop
 *   itself would hang.
 * - This is not a rate limit on the creator. A work that commits as fast as main can apply runs at
 *   main's pace, and nothing is dropped.
 */

/**
 * Small on purpose: two in flight keeps main busy while the next batch is built, and more only
 * lengthens the queue main can fall behind on.
 */
export const RUNTIME_MAX_UNACKNOWLEDGED_COMMITS = 2;

export interface RuntimeCommitFlow {
	/** The scheduler clock to give this session: the base clock with the gate in its yield. */
	readonly clock: RuntimeHostSchedulerClock;
	/** The worker posted the commit with this revision. */
	committed(revision: number): void;
	/** Main has handled every commit up to this revision. */
	acknowledged(revision: number): void;
	/**
	 * Runs `run` now if the gate is open and nothing is held; otherwise holds it behind the wakes
	 * already held, and runs them in order once main catches up (or on release). For wakes that would
	 * enqueue VM work from outside the scheduler: events and generation replies.
	 */
	admit(run: () => void): void;
	/** Opens the gate for good and runs what admit() held. Called before stopping or disposing. */
	release(): void;
	/** Commits posted and not yet acknowledged. */
	readonly unacknowledged: number;
}

export function createRuntimeCommitFlow(
	base: RuntimeHostSchedulerClock,
	maxUnacknowledged: number = RUNTIME_MAX_UNACKNOWLEDGED_COMMITS,
): RuntimeCommitFlow {
	let posted = 0;
	let answered = 0;
	let released = false;
	let waiters: (() => void)[] = [];
	let held: (() => void)[] = [];

	const open = (): boolean =>
		released || posted - answered <= maxUnacknowledged;

	const wake = (): void => {
		if (!open()) return;
		const ready = waiters;
		waiters = [];
		for (const waiter of ready) waiter();
		/**
		 * Held wakes run synchronously and in order. Running one only enqueues work, whose commits come
		 * from a later drain, so the gate cannot shut halfway through this loop.
		 */
		const admitted = held;
		held = [];
		for (const run of admitted) run();
	};

	return {
		clock: {
			now: () => base.now(),
			/**
			 * The base yield runs first, so the host gets its macrotask boundary whether or not the gate is
			 * shut; the gate only adds waiting on top of it.
			 */
			yield: async () => {
				await base.yield();
				if (open()) return;
				await new Promise<void>((resolve) => {
					waiters.push(resolve);
				});
			},
		},
		committed(revision) {
			/** Revisions only rise within a session; a max keeps a reordered call from lowering the count. */
			posted = Math.max(posted, revision);
		},
		acknowledged(revision) {
			/**
			 * An acknowledgement past what was posted can only be a stale message from another session's
			 * numbering. It is clamped, so it cannot open the gate for commits not yet sent.
			 */
			answered = Math.max(answered, Math.min(revision, posted));
			wake();
		},
		admit(run) {
			/** Behind anything already held, even if the gate has just opened: order is the promise. */
			if (held.length === 0 && open()) {
				run();
				return;
			}
			held.push(run);
		},
		release() {
			released = true;
			wake();
		},
		get unacknowledged() {
			return posted - answered;
		},
	};
}
