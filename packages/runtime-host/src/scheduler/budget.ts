/**
 * Accounting for the execution budget. Three axes overlap. The deadline for an interrupt is the
 * earlier of the execution and session deadlines. The slice only decides whether to start the next
 * turn (the reason is written in scheduler.ts's turn()).
 *
 * - execution: total VM use for one call. Same as Phase 3's executionMs.
 * - slice: the synchronous span before the host regains control. Several turns share one slice.
 * - session: optional. VM use within a rolling window. The default is none (null).
 *
 * The three axes exist because Phase 4B's question shifts from "how long can this call run" to "how
 * much VM time can this frame have". A per-call budget cannot answer that. A slice budget alone
 * would let one infinite loop keep running a little in every slice forever. Both are needed, and
 * this file is their composition.
 *
 * The numbers are not production values (see DEFAULT_BUDGET_POLICY). What this file defines is
 * where time is counted and what counts as the deadline. The values are set by the later resource
 * policy.
 */

export interface RuntimeBudgetPolicy {
	/**
	 * Time one execution may spend inside the VM, in milliseconds. Time spent waiting on the host is
	 * not counted.
	 */
	executionMs: number;
	/** Upper bound for one slice. Several turns run within it. */
	sliceMs: number;
	/** Max turns per slice. The scheduler yields at this count even if time remains. */
	maxTurnsPerSlice: number;
	/** Max VM jobs (microtasks) per turn. */
	maxJobsPerTurn: number;
	/** Total session use within the rolling window. `null` means it is not counted. */
	session: { windowMs: number; maxMs: number } | null;
}

export const DEFAULT_BUDGET_POLICY: RuntimeBudgetPolicy = Object.freeze({
	executionMs: 1_000,
	sliceMs: 16,
	maxTurnsPerSlice: 32,
	maxJobsPerTurn: 1_000,
	/**
	 * The session total budget has a default. It was `null` for a while, and in that state only the
	 * per-execution 1-second limit and slice yielding applied. Creator code could then use 16 ms of
	 * every frame forever. The host would not freeze, but the viewer's battery would pay for it. 250
	 * ms in a 1-second window (25%) is a value that apps with normal render, event, and effect work
	 * never reach. A host that needs more widens it. Narrowing is the default direction.
	 */
	session: { windowMs: 1_000, maxMs: 250 },
});

/**
 * How far past its interrupt deadline a turn may end before it counts as a budget overrun.
 *
 * The interrupt only reaches bytecode and the regex engine. A native builtin is one uninterruptible
 * call, and `"a".repeat(n).includes(...)` with a long near-miss needle is quadratic inside that call:
 * 2 s with `executionMs: 100`, reported as success. Host work inside the turn (commit validation,
 * reading a thrown value) is just as uninterruptible. So the scheduler measures the turn after it
 * returns, and a turn that ran past its deadline by more than this is fatal like an interrupt.
 *
 * Why 100 ms. Inside the VM the interrupt lands within microseconds of the deadline, so what this
 * absorbs is one stretch of host work or one native call that started just before it: the linear
 * ledger walk of a 5,000-node commit, a GC pause, a worker or WebView thread descheduled on a slow
 * phone. Those are tens of milliseconds at worst. A smaller value would end healthy sessions for the
 * device's sake; a larger one only lengthens the one freeze it still allows. A turn that never
 * returns is not this layer's question — the host that owns the thread needs a watchdog for that.
 */
export const RUNTIME_TURN_OVERRUN_GRACE_MS = 100;

/**
 * The remaining time and the single operation that consumes it. All three axes share this shape.
 */
export interface RuntimeBudgetAccount {
	remainingMs(now: number): number;
	charge(now: number, ms: number): void;
}

export class ExecutionAccount implements RuntimeBudgetAccount {
	private left: number;
	constructor(totalMs: number) {
		this.left = totalMs;
	}
	remainingMs(): number {
		return this.left;
	}
	charge(_now: number, ms: number): void {
		this.left -= ms;
	}
}

export class SliceAccount implements RuntimeBudgetAccount {
	private readonly deadline: number;
	turns = 0;
	constructor(
		startedAt: number,
		private readonly policy: RuntimeBudgetPolicy,
	) {
		this.deadline = startedAt + policy.sliceMs;
	}
	remainingMs(now: number): number {
		return this.deadline - now;
	}
	charge(): void {
		this.turns += 1;
	}
	/** Yield when either the turn count or the time has run out. */
	exhausted(now: number): boolean {
		return (
			this.turns >= this.policy.maxTurnsPerSlice || this.remainingMs(now) <= 0
		);
	}
}

/**
 * A rolling window: the total VM time used in the last `windowMs` must not exceed `maxMs`.
 *
 * Samples are kept in an array, and entries outside the window are dropped from the front. The
 * sample count equals the turn count, and turns are capped by slices, so the array cannot grow
 * without bound.
 */
export class RollingSessionAccount implements RuntimeBudgetAccount {
	private readonly samples: { at: number; ms: number }[] = [];
	constructor(private readonly window: { windowMs: number; maxMs: number }) {}
	private prune(now: number): void {
		const floor = now - this.window.windowMs;
		while (
			this.samples.length > 0 &&
			(this.samples[0] as { at: number }).at < floor
		)
			this.samples.shift();
	}
	remainingMs(now: number): number {
		this.prune(now);
		let used = 0;
		for (const sample of this.samples) used += sample.ms;
		return this.window.maxMs - used;
	}
	charge(now: number, ms: number): void {
		this.samples.push({ at: now, ms });
	}
}

/**
 * The earliest deadline among the accounts. A negative value means the deadline has already passed.
 */
export function earliestDeadline(
	now: number,
	accounts: readonly RuntimeBudgetAccount[],
): number {
	return earliestDeadlineOf(now, accounts).deadline;
}

/**
 * The earliest deadline and the index of the account that set it (`-1` when there are none). On a
 * tie the earlier account wins, so the order the caller passes is the order of blame.
 */
export function earliestDeadlineOf(
	now: number,
	accounts: readonly RuntimeBudgetAccount[],
): { deadline: number; index: number } {
	let remaining = Number.POSITIVE_INFINITY;
	let index = -1;
	accounts.forEach((account, at) => {
		const left = account.remainingMs(now);
		if (left < remaining) {
			remaining = left;
			index = at;
		}
	});
	return { deadline: now + Math.max(0, remaining), index };
}
