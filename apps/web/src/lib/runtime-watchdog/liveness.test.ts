import { readFileSync } from "node:fs";
import { DEFAULT_BUDGET_POLICY } from "@rowcat/runtime-host/scheduler/budget";
import { describe, expect, it } from "vitest";
import {
	RUNTIME_LIVENESS_INTERVAL_MS,
	RUNTIME_LIVENESS_TIMEOUT_MS,
	RUNTIME_UNRESPONSIVE_CODE,
	type RuntimeLivenessTimers,
	watchRuntimeLiveness,
	watchRuntimeWorker,
} from "./liveness.ts";

/**
 * The watchdog's rules, with time and message turns under the test's hand. The worker side is one
 * line in each worker's message handler (answer a ping with its number); what can go wrong is here:
 * judging too early, judging a busy main thread as a stuck worker, or judging after a stop.
 */

function harness() {
	let now = 0;
	const timers: { at: number; run: () => void; handle: number }[] = [];
	let messages: (() => void)[] = [];
	let nextHandle = 1;
	const port: RuntimeLivenessTimers = {
		now: () => now,
		setTimeout: (run, ms) => {
			const handle = nextHandle++;
			timers.push({ at: now + ms, run, handle });
			return handle;
		},
		clearTimeout: (handle) => {
			const index = timers.findIndex((timer) => timer.handle === handle);
			if (index >= 0) timers.splice(index, 1);
		},
		afterQueuedMessages: (run) => {
			messages.push(run);
		},
	};
	return {
		port,
		/** Advances the clock and fires due timers in order (main is free). */
		advance(ms: number) {
			const until = now + ms;
			for (;;) {
				timers.sort((a, b) => a.at - b.at);
				const due = timers[0];
				if (due === undefined || due.at > until) break;
				timers.shift();
				now = due.at;
				due.run();
			}
			now = until;
		},
		/** Main was blocked: the clock jumps and only then do timers fire. */
		block(ms: number) {
			now += ms;
		},
		fireDue() {
			this.advance(0);
		},
		drainMessages() {
			const ready = messages;
			messages = [];
			for (const run of ready) run();
		},
	};
}

describe("runtime liveness", () => {
	it("a worker that answers is never judged", () => {
		const h = harness();
		const pings: number[] = [];
		let verdicts = 0;
		const watch = watchRuntimeLiveness({
			ping: (seq) => pings.push(seq),
			onUnresponsive: () => {
				verdicts += 1;
			},
			timers: h.port,
		});
		for (let second = 0; second < 60; second += 1) {
			/** The worker answers each ping between turns, a moment after it was sent. */
			watch.answered(pings.at(-1) ?? 0);
			h.advance(1_000);
			h.drainMessages();
		}
		expect(verdicts).toBe(0);
		expect(pings.length).toBeGreaterThan(30);
	});

	it("a worker stuck in a turn is judged once the bound passes, and only once", () => {
		const h = harness();
		let verdicts = 0;
		watchRuntimeLiveness({
			ping: () => undefined,
			onUnresponsive: () => {
				verdicts += 1;
			},
			timers: h.port,
		});
		h.advance(RUNTIME_LIVENESS_TIMEOUT_MS - 1);
		h.drainMessages();
		expect(verdicts).toBe(0);
		h.advance(RUNTIME_LIVENESS_INTERVAL_MS);
		expect(verdicts).toBe(0);
		h.drainMessages();
		expect(verdicts).toBe(1);
		h.advance(30_000);
		h.drainMessages();
		expect(verdicts).toBe(1);
	});

	it("an answer queued while main was blocked is read before the verdict", () => {
		const h = harness();
		let verdicts = 0;
		const watch = watchRuntimeLiveness({
			ping: () => undefined,
			onUnresponsive: () => {
				verdicts += 1;
			},
			timers: h.port,
		});
		/** Main blocks for longer than the bound; the worker's answer is waiting in the queue. */
		h.block(RUNTIME_LIVENESS_TIMEOUT_MS + 2_000);
		h.fireDue();
		watch.answered(1);
		h.drainMessages();
		expect(verdicts).toBe(0);
		h.advance(2_000);
		watch.answered(2);
		h.drainMessages();
		expect(verdicts).toBe(0);
	});

	it("an answer to an older ping does not clear a newer one", () => {
		const h = harness();
		let verdicts = 0;
		const pings: number[] = [];
		const watch = watchRuntimeLiveness({
			ping: (seq) => pings.push(seq),
			onUnresponsive: () => {
				verdicts += 1;
			},
			timers: h.port,
		});
		watch.answered(1);
		h.advance(RUNTIME_LIVENESS_INTERVAL_MS);
		expect(pings).toEqual([1, 2]);
		h.advance(RUNTIME_LIVENESS_TIMEOUT_MS);
		watch.answered(1);
		h.drainMessages();
		expect(verdicts).toBe(1);
	});

	it("no verdict after stop, even one already suspected", () => {
		const h = harness();
		let verdicts = 0;
		const watch = watchRuntimeLiveness({
			ping: () => undefined,
			onUnresponsive: () => {
				verdicts += 1;
			},
			timers: h.port,
		});
		h.advance(RUNTIME_LIVENESS_TIMEOUT_MS + RUNTIME_LIVENESS_INTERVAL_MS);
		watch.stop();
		h.drainMessages();
		h.advance(60_000);
		h.drainMessages();
		expect(verdicts).toBe(0);
	});
});

describe("the bound against the budget", () => {
	/**
	 * A turn the VM budget would have cut must never be judged stuck: the budget answers it with a
	 * named failure the creator can read, and the watchdog answers with a terminated worker.
	 */
	it("exceeds the execution budget with a margin", () => {
		expect(RUNTIME_LIVENESS_TIMEOUT_MS).toBeGreaterThanOrEqual(
			DEFAULT_BUDGET_POLICY.executionMs * 4,
		);
	});

	it("speaks the budget's code", () => {
		expect(RUNTIME_UNRESPONSIVE_CODE).toBe("runtime_execution_budget_exceeded");
	});

	/**
	 * The main thread imports this module, so the one runtime-host path it pulls in by value must stay
	 * a leaf. If errors.ts ever imports anything, the session or engine could follow it onto main.
	 */
	it("pulls in only a leaf of runtime-host", () => {
		const errors = readFileSync(
			new URL(
				"../../../../../packages/runtime-host/src/errors.ts",
				import.meta.url,
			),
			"utf8",
		);
		expect(errors).not.toMatch(/^\s*import\s/m);
		expect(errors).not.toMatch(/\bfrom\s+"/);
	});
});

describe("a worker's watch follows what the worker says, not what main asks", () => {
	function worker() {
		const h = harness();
		const pings: number[] = [];
		let verdicts = 0;
		const watch = watchRuntimeWorker({
			ping: (seq) => pings.push(seq),
			onUnresponsive: () => {
				verdicts += 1;
			},
			timers: h.port,
		});
		return {
			h,
			watch,
			pings,
			verdicts: () => verdicts,
			/** The worker is between turns: it answers the ping main is waiting on. */
			answer() {
				watch.answered(pings.at(-1) ?? 0);
			},
		};
	}

	/**
	 * Finding: the player armed with its start and judged a worker whose script had not finished
	 * downloading. A worker that has not said anything has no message handler yet; silence then is the
	 * network's, not a stuck turn's.
	 */
	it("a worker still loading its script is not judged, however long it takes", () => {
		const w = worker();
		w.h.advance(60_000);
		w.h.drainMessages();
		expect(w.verdicts()).toBe(0);
		w.watch.observe("session-starting");
		w.h.advance(RUNTIME_LIVENESS_TIMEOUT_MS + RUNTIME_LIVENESS_INTERVAL_MS);
		w.h.drainMessages();
		expect(w.verdicts()).toBe(1);
	});

	/**
	 * Finding: pressing restart on a preview whose worker was stuck turned the watch off, and the new
	 * session's `starting` that would have re-armed it never came — the worker could not read the start.
	 * Asking for a new session changes nothing in the worker, so it changes nothing in the watch.
	 */
	it("a restart aimed at a stuck worker still reaches a verdict", () => {
		const w = worker();
		w.watch.observe("session-starting");
		w.h.advance(2_000);
		w.answer();
		/** A turn hangs; a moment later the creator presses restart. */
		w.h.advance(1_000);
		w.watch.restarting();
		w.h.advance(30_000);
		w.h.drainMessages();
		expect(w.verdicts()).toBe(1);
	});

	it("a restart of a healthy worker is not judged: its compile pauses the bound and its start resumes it", () => {
		const w = worker();
		w.watch.observe("session-starting");
		w.h.advance(1_000);
		w.answer();
		w.watch.restarting();
		/** The worker tears the old session down between turns, answering as it goes. */
		w.h.advance(500);
		w.answer();
		w.watch.observe("compiling");
		/** The compile is synchronous: nothing is answered for a long while. */
		w.h.advance(20_000);
		w.h.drainMessages();
		expect(w.verdicts()).toBe(0);
		w.watch.observe("session-starting");
		for (let second = 0; second < 30; second += 1) {
			w.h.advance(1_000);
			w.answer();
			w.h.drainMessages();
		}
		expect(w.verdicts()).toBe(0);
	});

	/**
	 * A session that dies in an effect reports `failed` outside the worker's chain, so it can land after
	 * the next session's `starting`. Pausing on it left that newer session's creator code unwatched.
	 */
	it("an older session's end does not pause the watch on a newer one", () => {
		const w = worker();
		w.watch.observe("session-starting", 1);
		w.watch.observe("compiling", 2);
		w.watch.observe("session-starting", 2);
		w.watch.observe("session-ended", 1);
		w.h.advance(RUNTIME_LIVENESS_TIMEOUT_MS + RUNTIME_LIVENESS_INTERVAL_MS * 2);
		w.h.drainMessages();
		expect(w.verdicts()).toBe(1);
	});

	it("the current session's end still pauses it", () => {
		const w = worker();
		w.watch.observe("session-starting", 2);
		w.watch.observe("session-ended", 2);
		w.h.advance(RUNTIME_LIVENESS_TIMEOUT_MS * 4);
		w.h.drainMessages();
		expect(w.verdicts()).toBe(0);
	});

	it("a ping left unanswered across a pause gets the full bound again after it", () => {
		const w = worker();
		w.watch.observe("session-starting");
		/** Ping 1 goes out and the worker enters its compile before answering. */
		w.h.advance(4_000);
		w.watch.observe("compiling");
		w.h.advance(10_000);
		w.watch.observe("session-starting");
		w.h.advance(RUNTIME_LIVENESS_TIMEOUT_MS - RUNTIME_LIVENESS_INTERVAL_MS);
		w.h.drainMessages();
		expect(w.verdicts()).toBe(0);
		w.h.advance(RUNTIME_LIVENESS_INTERVAL_MS * 2);
		w.h.drainMessages();
		expect(w.verdicts()).toBe(1);
	});

	it("a verdict already suspected does not land after a pause", () => {
		const w = worker();
		w.watch.observe("session-starting");
		w.h.advance(RUNTIME_LIVENESS_TIMEOUT_MS + RUNTIME_LIVENESS_INTERVAL_MS);
		/** The suspicion is waiting on one message turn; the worker's `compiling` is in that turn. */
		w.watch.observe("compiling");
		w.watch.observe("session-starting");
		w.h.drainMessages();
		expect(w.verdicts()).toBe(0);
	});

	it("a worker with no session is not watched", () => {
		const w = worker();
		w.watch.observe("session-starting");
		w.h.advance(1_000);
		w.answer();
		w.watch.observe("session-ended");
		w.h.advance(60_000);
		w.h.drainMessages();
		expect(w.verdicts()).toBe(0);
	});
});
