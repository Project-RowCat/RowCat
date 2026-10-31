import type { RuntimeVmSlice } from "../vm/types.ts";
import {
	DEFAULT_BUDGET_POLICY,
	earliestDeadlineOf,
	RollingSessionAccount,
	RUNTIME_TURN_OVERRUN_GRACE_MS,
	type RuntimeBudgetAccount,
	type RuntimeBudgetPolicy,
	SliceAccount,
} from "./budget.ts";
import {
	defaultSchedulerClock,
	type RuntimeHostSchedulerClock,
} from "./clock.ts";
import type { RuntimeWorkPriority } from "./priority.ts";
import { type QueuedWork, RuntimeWorkQueue } from "./queue.ts";

/**
 * Runtime scheduler. It decides only when the VM gets its next turn.
 *
 * - enqueue starts a drain after one microtask, so work never enters the VM synchronously.
 * - A slice runs turns from the queue. Slice time and turn count decide whether another turn
 *   starts. When the queue is empty the slice ends. Otherwise it yields to the host through
 *   clock.yield().
 * - The interrupt deadline of one turn is the execution and session budget, not the slice. A turn
 *   cannot be resumed, so cutting one ends the session (see the comment on turn()).
 * - The interrupt cannot reach a native builtin or host work inside the turn, so the turn is also
 *   measured after it returns. One that ran past its deadline by more than
 *   RUNTIME_TURN_OVERRUN_GRACE_MS is fatal like an interrupt (budget.ts says why that value).
 * - Not known here: capability meanings, what a turn does in the VM (the session's runTurn), or
 *   engine handles. Only the slice shape from vm/types.ts is imported.
 * - No re-entry. There is one drain loop. enqueue never runs a turn inline, even when a host
 *   completion arrives during a VM turn. scheduler.test.ts checks that turn depth never exceeds 1.
 * - Same-priority order is FIFO. requeue takes a new sequence number and joins the back, so a
 *   long promise chain cannot monopolize the queue. An execution keeps its own order: its turns
 *   enter the queue only after the previous turn ends.
 */

export type RuntimeTurnOutcome =
	| { kind: "done" }
	/** More work remains. The item goes to the back of its priority bucket. */
	| { kind: "requeue" }
	/** Waiting on the host. The item is out of the queue until a completion arrives as new work. */
	| { kind: "waiting" }
	/** The VM can no longer be trusted. The queue is drained and the scheduler stops. */
	| { kind: "fatal" };

/**
 * Which budget set a turn's interrupt deadline: the work's own accounts (the session gives one per
 * execution) or the scheduler's rolling session account. The two are cut by the same interrupt, and
 * a failure message that names the wrong one sends the reader to the wrong limit.
 */
export type RuntimeTurnLimit = "own" | "session";

/** The slice one turn receives. The VM sees it as a plain RuntimeVmSlice. */
export interface RuntimeTurnSlice extends RuntimeVmSlice {
	/** null when no account bounds the turn (the deadline is then infinite). */
	readonly limitedBy: RuntimeTurnLimit | null;
}

/** A turn that ended later than its deadline plus the grace. */
export interface RuntimeTurnOverrun {
	ms: number;
	allowedMs: number;
	limitedBy: RuntimeTurnLimit | null;
}

export interface RuntimeSchedulerMetrics {
	turns: number;
	slices: number;
	yields: number;
	/** Items enqueued: requests, pumps, and host completions combined. */
	enqueued: number;
	hostCompletions: number;
	discarded: number;
	maxQueueDepth: number;
	/** Total milliseconds spent in VM turns. Host waiting time is not included. */
	vmMs: number;
	maxTurnMs: number;
	maxSliceMs: number;
}

export interface RuntimeSchedulerObserver {
	onTurn?(info: {
		priority: RuntimeWorkPriority;
		sequence: number;
		ms: number;
		outcome: RuntimeTurnOutcome["kind"];
		/** Number of turns open while this turn runs. This must always be 1. */
		depth: number;
	}): void;
	onSlice?(info: { turns: number; ms: number }): void;
	onYield?(): void;
}

export interface RuntimeSchedulerOptions<T> {
	clock?: RuntimeHostSchedulerClock;
	policy?: Partial<RuntimeBudgetPolicy>;
	observer?: RuntimeSchedulerObserver;
	/**
	 * Runs one work item as one VM turn. Synchronous, and it must finish within the slice deadline.
	 */
	runTurn(
		work: QueuedWork<T>,
		slice: RuntimeTurnSlice,
		/**
		 * The work's own budgets. The session gives one per execution. Without them, only the slice is
		 * checked.
		 */
		accounts: readonly RuntimeBudgetAccount[],
	): RuntimeTurnOutcome;
	/**
	 * Called once after every turn that returned, with the turn's own outcome and, when it ran past
	 * its deadline by more than the grace, the overrun. Returns the outcome the scheduler acts on.
	 * Without it, an overrun is fatal and any other outcome stands.
	 *
	 * It exists because the turn's verdict is only known here, after the clock is read, while the
	 * owner of the work decides what a budget failure means for it (the session rejects the execution
	 * that owned the turn rather than reporting the value it computed).
	 */
	finishTurn?(
		work: QueuedWork<T>,
		outcome: RuntimeTurnOutcome,
		overrun: RuntimeTurnOverrun | null,
	): RuntimeTurnOutcome;
	/**
	 * Called for each work item that cancellation or a fatal failure drops from the queue. This is
	 * where the session rejects that execution.
	 */
	onDiscard(work: QueuedWork<T>, reason: "cancelled" | "failed"): void;
	/** Returns the work's own budget accounts. Returns an empty array when the work has none. */
	accountsOf?(work: QueuedWork<T>): readonly RuntimeBudgetAccount[];
	isCancelled(): boolean;
}

export class RuntimeScheduler<T> {
	readonly policy: RuntimeBudgetPolicy;
	private readonly clock: RuntimeHostSchedulerClock;
	private readonly queue = new RuntimeWorkQueue<T>();
	private readonly session: RollingSessionAccount | null;
	private readonly options: RuntimeSchedulerOptions<T>;
	private draining = false;
	private scheduled = false;
	private stopped: "cancelled" | "failed" | null = null;
	private depth = 0;
	private idleWaiters: (() => void)[] = [];
	private readonly counters: RuntimeSchedulerMetrics = {
		turns: 0,
		slices: 0,
		yields: 0,
		enqueued: 0,
		hostCompletions: 0,
		discarded: 0,
		maxQueueDepth: 0,
		vmMs: 0,
		maxTurnMs: 0,
		maxSliceMs: 0,
	};

	constructor(options: RuntimeSchedulerOptions<T>) {
		this.options = options;
		this.clock = options.clock ?? defaultSchedulerClock();
		this.policy = { ...DEFAULT_BUDGET_POLICY, ...options.policy };
		this.session =
			this.policy.session === null
				? null
				: new RollingSessionAccount(this.policy.session);
	}

	get stopReason(): "cancelled" | "failed" | null {
		return this.stopped;
	}

	metrics(): RuntimeSchedulerMetrics {
		return { ...this.counters };
	}

	/**
	 * Enqueues a work item. A stopped scheduler does not accept it. It is discarded at once, and the
	 * caller learns this through onDiscard. No work vanishes silently.
	 */
	enqueue(
		item: T,
		priority: RuntimeWorkPriority,
		kind: "request" | "host-completion" = "request",
	): void {
		this.counters.enqueued += 1;
		if (kind === "host-completion") this.counters.hostCompletions += 1;
		if (this.stopped !== null) {
			this.counters.discarded += 1;
			this.options.onDiscard({ sequence: 0, priority, item }, this.stopped);
			return;
		}
		this.queue.enqueue(item, priority);
		this.counters.maxQueueDepth = Math.max(
			this.counters.maxQueueDepth,
			this.queue.size,
		);
		this.kick();
	}

	/**
	 * Schedules the drain for the next microtask, so all work enqueued in the same tick gets its
	 * sequence number before the drain starts.
	 */
	private kick(): void {
		if (this.draining || this.scheduled) return;
		this.scheduled = true;
		void Promise.resolve().then(() => {
			this.scheduled = false;
			void this.drain();
		});
	}

	/**
	 * Resolves when the queue is empty and the drain has finished. Disposal waits here for the last
	 * turn.
	 */
	idle(): Promise<void> {
		if (!this.draining && this.queue.size === 0 && !this.scheduled)
			return Promise.resolve();
		return new Promise((resolve) => {
			this.idleWaiters.push(resolve);
		});
	}

	/**
	 * Empties the queue and stops accepting work. A turn already running is cut off by the slice's
	 * cancellation check.
	 */
	stop(reason: "cancelled" | "failed"): void {
		if (this.stopped !== null) return;
		this.stopped = reason;
		for (const work of this.queue.drain()) {
			this.counters.discarded += 1;
			this.options.onDiscard(work, reason);
		}
	}

	private settleIdle(): void {
		if (this.draining || this.queue.size > 0 || this.scheduled) return;
		const waiters = this.idleWaiters;
		this.idleWaiters = [];
		for (const waiter of waiters) waiter();
	}

	private async drain(): Promise<void> {
		if (this.draining) return;
		this.draining = true;
		try {
			while (this.stopped === null && this.queue.size > 0) {
				const sliceStarted = this.clock.now();
				const slice = new SliceAccount(sliceStarted, this.policy);
				this.counters.slices += 1;
				while (this.stopped === null) {
					const now = this.clock.now();
					if (slice.exhausted(now)) break;
					const work = this.queue.dequeue();
					if (work === null) break;
					this.turn(work, slice, now);
				}
				const sliceMs = this.clock.now() - sliceStarted;
				this.counters.maxSliceMs = Math.max(this.counters.maxSliceMs, sliceMs);
				this.options.observer?.onSlice?.({ turns: slice.turns, ms: sliceMs });
				if (this.stopped !== null || this.queue.size === 0) break;
				this.counters.yields += 1;
				this.options.observer?.onYield?.();
				await this.clock.yield();
			}
		} finally {
			this.draining = false;
			this.settleIdle();
			if (this.stopped === null && this.queue.size > 0) this.kick();
		}
	}

	private turn(
		work: QueuedWork<T>,
		slice: SliceAccount,
		started: number,
	): void {
		const own = this.options.accountsOf?.(work) ?? [];
		/**
		 * The interrupt deadline is the execution and session budget, not the slice. A turn cannot be
		 * undone or resumed, so interrupting one ends the session (see failures.ts). Cutting a turn at
		 * the slice's remaining time is an execution, not a yield. It would hit every author whose render
		 * runs past one frame. The Phase 4B reconciler is synchronous and cannot be split: a 3,000-node
		 * mount takes more than 16 ms.
		 *
		 * The slice only decides whether to start the next turn (`exhausted`). That check is where the
		 * host regains control each frame. Slice accounting is still charged, because it feeds metrics
		 * and yield decisions.
		 */
		const interruptible: RuntimeBudgetAccount[] = [...own];
		if (this.session !== null) interruptible.push(this.session);
		const accounts: RuntimeBudgetAccount[] = [slice, ...interruptible];
		const earliest = earliestDeadlineOf(started, interruptible);
		const deadline = earliest.deadline;
		const limitedBy: RuntimeTurnLimit | null =
			earliest.index < 0
				? null
				: earliest.index < own.length
					? "own"
					: "session";
		const vmSlice: RuntimeTurnSlice = {
			deadline,
			now: () => this.clock.now(),
			isCancelled: () => this.options.isCancelled(),
			limitedBy,
		};
		this.depth += 1;
		const depth = this.depth;
		let outcome: RuntimeTurnOutcome;
		try {
			outcome = this.options.runTurn(work, vmSlice, own);
		} finally {
			this.depth -= 1;
		}
		const ms = Math.max(0, this.clock.now() - started);
		/**
		 * The time is charged before the verdict, so an overrun turn still drains the accounts it used.
		 * A fatal outcome is not measured again: the turn already failed for its own reason.
		 */
		for (const account of accounts) account.charge(started, ms);
		const allowedMs = deadline - started;
		const overrun: RuntimeTurnOverrun | null =
			outcome.kind !== "fatal" && ms > allowedMs + RUNTIME_TURN_OVERRUN_GRACE_MS
				? { ms, allowedMs, limitedBy }
				: null;
		outcome = this.options.finishTurn
			? this.options.finishTurn(work, outcome, overrun)
			: overrun !== null
				? { kind: "fatal" }
				: outcome;
		this.counters.turns += 1;
		this.counters.vmMs += ms;
		this.counters.maxTurnMs = Math.max(this.counters.maxTurnMs, ms);
		this.options.observer?.onTurn?.({
			priority: work.priority,
			sequence: work.sequence,
			ms,
			outcome: outcome.kind,
			depth,
		});
		if (outcome.kind === "requeue") {
			this.queue.enqueue(work.item, work.priority);
			this.counters.maxQueueDepth = Math.max(
				this.counters.maxQueueDepth,
				this.queue.size,
			);
		} else if (outcome.kind === "fatal") this.stop("failed");
	}
}
