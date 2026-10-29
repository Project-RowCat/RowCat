import { describe, expect, it } from "vitest";
import type { RuntimeVmSlice } from "../vm/types.ts";
import {
	ExecutionAccount,
	earliestDeadline,
	RollingSessionAccount,
	SliceAccount,
} from "./budget.ts";
import type { RuntimeHostSchedulerClock } from "./clock.ts";
import { failureSeverity } from "./failures.ts";
import { compareWorkOrder, PRIORITY_RANK } from "./priority.ts";
import { RuntimeWorkQueue } from "./queue.ts";
import {
	RuntimeScheduler,
	type RuntimeSchedulerOptions,
	type RuntimeTurnOutcome,
} from "./scheduler.ts";

/**
 * Tests the scheduler rules without a VM: order, priority, yielding, cancellation, no re-entry, and
 * fatal stop. What a turn does inside the VM belongs to the session. session.test.ts checks that
 * against a real engine.
 */

/** Manually driven clock. The test caller releases each yield. */
const manualClock = () => {
	let time = 0;
	let waiters: (() => void)[] = [];
	const clock: RuntimeHostSchedulerClock = {
		now: () => time,
		yield: () =>
			new Promise((resolve) => {
				waiters.push(resolve);
			}),
	};
	return {
		clock,
		advance: (ms: number) => {
			time += ms;
		},
		release: () => {
			const current = waiters;
			waiters = [];
			for (const waiter of current) waiter();
		},
		pending: () => waiters.length,
	};
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

interface Task {
	name: string;
	run: (slice: RuntimeVmSlice) => RuntimeTurnOutcome;
}

const done = (): RuntimeTurnOutcome => ({ kind: "done" });

function build(
	overrides: Partial<RuntimeSchedulerOptions<Task>> & {
		clock?: RuntimeHostSchedulerClock;
	} = {},
) {
	const log: string[] = [];
	const discarded: string[] = [];
	let depthSeen = 0;
	let cancelled = false;
	const scheduler = new RuntimeScheduler<Task>({
		clock: overrides.clock,
		policy: overrides.policy,
		runTurn: (work, slice) => {
			log.push(work.item.name);
			return work.item.run(slice);
		},
		onDiscard: (work, reason) => discarded.push(`${work.item.name}:${reason}`),
		isCancelled: () => cancelled,
		observer: {
			onTurn: (info) => {
				depthSeen = Math.max(depthSeen, info.depth);
			},
		},
		...overrides,
	});
	return {
		scheduler,
		log,
		discarded,
		depth: () => depthSeen,
		cancel: () => {
			cancelled = true;
			scheduler.stop("cancelled");
		},
	};
}

describe("priority and sequence", () => {
	it("higher priority first, and on ties the earlier arrival", () => {
		expect(
			compareWorkOrder(
				{ priority: "normal", sequence: 1 },
				{ priority: "userBlocking", sequence: 2 },
			),
		).toBeGreaterThan(0);
		expect(
			compareWorkOrder(
				{ priority: "normal", sequence: 1 },
				{ priority: "normal", sequence: 2 },
			),
		).toBeLessThan(0);
		expect(PRIORITY_RANK.immediate).toBeLessThan(PRIORITY_RANK.background);
	});

	it("the queue is FIFO across four buckets", () => {
		const queue = new RuntimeWorkQueue<string>();
		queue.enqueue("a", "normal");
		queue.enqueue("b", "background");
		queue.enqueue("c", "normal");
		queue.enqueue("d", "immediate");
		expect(queue.size).toBe(4);
		expect(queue.depth()).toEqual({
			immediate: 1,
			userBlocking: 0,
			normal: 2,
			background: 1,
		});
		expect(["d", "a", "c", "b"].map(() => queue.dequeue()?.item)).toEqual([
			"d",
			"a",
			"c",
			"b",
		]);
		expect(queue.dequeue()).toBeNull();
	});
});

describe("drain", () => {
	it("the same priority runs in arrival order (FIFO)", async () => {
		const { scheduler, log } = build();
		for (const name of ["A", "B", "C"])
			scheduler.enqueue({ name, run: done }, "normal");
		await scheduler.idle();
		expect(log).toEqual(["A", "B", "C"]);
	});

	it("higher priority runs before queued lower work", async () => {
		const { scheduler, log } = build();
		scheduler.enqueue({ name: "bg", run: done }, "background");
		scheduler.enqueue({ name: "normal", run: done }, "normal");
		scheduler.enqueue({ name: "event", run: done }, "userBlocking");
		scheduler.enqueue({ name: "teardown", run: done }, "immediate");
		await scheduler.idle();
		expect(log).toEqual(["teardown", "event", "normal", "bg"]);
	});

	it("enqueue does not turn a turn on the spot: it starts after every task in the same tick has a sequence number", async () => {
		const { scheduler, log } = build();
		scheduler.enqueue({ name: "late-normal", run: done }, "normal");
		expect(log).toEqual([]);
		scheduler.enqueue({ name: "urgent", run: done }, "userBlocking");
		await scheduler.idle();
		expect(log).toEqual(["urgent", "late-normal"]);
	});

	it("long work splits across turns with requeue and stands behind new work of the same priority", async () => {
		const { scheduler, log } = build();
		let steps = 3;
		scheduler.enqueue(
			{ name: "long", run: () => (--steps > 0 ? { kind: "requeue" } : done()) },
			"normal",
		);
		scheduler.enqueue({ name: "other", run: done }, "normal");
		await scheduler.idle();
		expect(log).toEqual(["long", "other", "long", "long"]);
	});

	it("yields to the event loop at the slice's turn cap", async () => {
		const clock = manualClock();
		const { scheduler, log } = build({
			clock: clock.clock,
			policy: { maxTurnsPerSlice: 2, sliceMs: 1_000 },
		});
		for (const name of ["a", "b", "c", "d", "e"])
			scheduler.enqueue({ name, run: done }, "normal");
		await tick();
		expect(log).toEqual(["a", "b"]);
		expect(clock.pending()).toBe(1);
		clock.release();
		await tick();
		expect(log).toEqual(["a", "b", "c", "d"]);
		clock.release();
		await scheduler.idle();
		expect(log).toEqual(["a", "b", "c", "d", "e"]);
		expect(scheduler.metrics().yields).toBe(2);
		expect(scheduler.metrics().slices).toBe(3);
	});

	it("yields at the slice's time cap too", async () => {
		const clock = manualClock();
		const { scheduler, log } = build({
			clock: clock.clock,
			policy: { maxTurnsPerSlice: 100, sliceMs: 10 },
		});
		const slow: Task = {
			name: "slow",
			run: () => {
				clock.advance(6);
				return done();
			},
		};
		for (let i = 0; i < 3; i += 1) scheduler.enqueue(slow, "normal");
		await tick();
		expect(log.length).toBe(2);
		clock.release();
		await scheduler.idle();
		expect(log.length).toBe(3);
	});

	/**
	 * A slice never cuts a running turn. A turn cannot be resumed, so cutting one ends the session. A
	 * 3,000-node render that runs past 16 ms still runs to its own execution budget.
	 */
	it("a turn's interrupt deadline is the execution and session budget, not the slice", async () => {
		const clock = manualClock();
		let seen: number | null = null;
		const { scheduler, log } = build({
			clock: clock.clock,
			policy: { maxTurnsPerSlice: 100, sliceMs: 10, executionMs: 1_000 },
		});
		scheduler.enqueue(
			{
				name: "long-render",
				run: (slice) => {
					seen = slice.deadline - slice.now();
					clock.advance(40);
					return done();
				},
			},
			"normal",
		);
		await scheduler.idle();
		expect(log).toEqual(["long-render"]);
		expect(seen).toBeGreaterThan(10);
	});

	it("deadline accounts compose to the earliest", () => {
		const slice = new SliceAccount(100, {
			executionMs: 1_000,
			sliceMs: 16,
			maxTurnsPerSlice: 8,
			maxJobsPerTurn: 10,
			session: null,
		});
		const execution = new ExecutionAccount(5);
		const session = new RollingSessionAccount({ windowMs: 1_000, maxMs: 50 });
		expect(earliestDeadline(100, [slice, execution, session])).toBe(105);
		execution.charge(100, 5);
		expect(earliestDeadline(100, [slice, execution])).toBe(100);
		session.charge(100, 50);
		expect(session.remainingMs(100)).toBe(0);
		expect(session.remainingMs(1_200)).toBe(50);
	});

	it("no turn opens inside a turn: depth is always 1", async () => {
		const built = build();
		built.scheduler.enqueue(
			{
				name: "outer",
				run: () => {
					/**
					 * Work enqueued during a turn, such as a host completion, is only queued. It does not run
					 * inline.
					 */
					built.scheduler.enqueue(
						{ name: "inner", run: done },
						"immediate",
						"host-completion",
					);
					return done();
				},
			},
			"normal",
		);
		await built.scheduler.idle();
		expect(built.log).toEqual(["outer", "inner"]);
		expect(built.depth()).toBe(1);
		expect(built.scheduler.metrics().hostCompletions).toBe(1);
	});

	it("waiting work is not in the queue, and completion comes in as new work", async () => {
		const { scheduler, log } = build();
		scheduler.enqueue(
			{ name: "wait", run: () => ({ kind: "waiting" }) },
			"normal",
		);
		scheduler.enqueue({ name: "next", run: done }, "normal");
		await scheduler.idle();
		expect(log).toEqual(["wait", "next"]);
		scheduler.enqueue(
			{ name: "resume", run: done },
			"normal",
			"host-completion",
		);
		await scheduler.idle();
		expect(log).toEqual(["wait", "next", "resume"]);
	});
});

describe("cancellation and fatal failure", () => {
	it("cancellation empties the queue and accepts no further work", async () => {
		const built = build();
		built.scheduler.enqueue({ name: "a", run: done }, "normal");
		built.scheduler.enqueue({ name: "b", run: done }, "background");
		built.cancel();
		built.scheduler.enqueue({ name: "late", run: done }, "immediate");
		await built.scheduler.idle();
		expect(built.log).toEqual([]);
		expect(built.discarded).toEqual([
			"a:cancelled",
			"b:cancelled",
			"late:cancelled",
		]);
		expect(built.scheduler.stopReason).toBe("cancelled");
	});

	it("cancelled inside a running slice, the remaining work does not run", async () => {
		const built = build();
		built.scheduler.enqueue(
			{
				name: "first",
				run: () => {
					built.cancel();
					return done();
				},
			},
			"normal",
		);
		built.scheduler.enqueue({ name: "second", run: done }, "normal");
		await built.scheduler.idle();
		expect(built.log).toEqual(["first"]);
		expect(built.discarded).toEqual(["second:cancelled"]);
	});

	it("a fatal failure empties the queue and stops: nothing enters after it", async () => {
		const built = build();
		built.scheduler.enqueue(
			{ name: "boom", run: () => ({ kind: "fatal" }) },
			"normal",
		);
		built.scheduler.enqueue({ name: "after", run: done }, "normal");
		await built.scheduler.idle();
		expect(built.log).toEqual(["boom"]);
		expect(built.discarded).toEqual(["after:failed"]);
		expect(built.scheduler.stopReason).toBe("failed");
		built.scheduler.enqueue({ name: "more", run: done }, "immediate");
		expect(built.discarded).toEqual(["after:failed", "more:failed"]);
	});

	it("a recoverable failure ends only that task and the next one runs", async () => {
		const { scheduler, log } = build();
		scheduler.enqueue({ name: "throws", run: done }, "normal");
		scheduler.enqueue({ name: "next", run: done }, "normal");
		await scheduler.idle();
		expect(log).toEqual(["throws", "next"]);
		expect(scheduler.stopReason).toBeNull();
	});

	it("the kind decides a failure's weight", () => {
		expect(failureSeverity({ kind: "memory" })).toBe("fatal");
		expect(failureSeverity({ kind: "interrupted" })).toBe("fatal");
		expect(failureSeverity({ kind: "engine", message: "" })).toBe("fatal");
		expect(
			failureSeverity({
				kind: "thrown",
				name: "TypeError",
				message: "",
				stack: "",
				hostCode: null,
			}),
		).toBe("recoverable");
		expect(failureSeverity({ kind: "lookup", reason: "export" })).toBe(
			"recoverable",
		);
	});
});

describe("instrumentation", () => {
	it("counts turns, slices, yields and queue depth", async () => {
		const clock = manualClock();
		const { scheduler } = build({
			clock: clock.clock,
			policy: { maxTurnsPerSlice: 1, sliceMs: 100 },
		});
		scheduler.enqueue(
			{
				name: "a",
				run: () => {
					clock.advance(2);
					return done();
				},
			},
			"normal",
		);
		scheduler.enqueue(
			{
				name: "b",
				run: () => {
					clock.advance(3);
					return done();
				},
			},
			"normal",
		);
		await tick();
		clock.release();
		await scheduler.idle();
		const metrics = scheduler.metrics();
		expect(metrics.turns).toBe(2);
		expect(metrics.slices).toBe(2);
		expect(metrics.yields).toBe(1);
		expect(metrics.enqueued).toBe(2);
		expect(metrics.maxQueueDepth).toBe(2);
		expect(metrics.vmMs).toBe(5);
		expect(metrics.maxTurnMs).toBe(3);
	});
});
