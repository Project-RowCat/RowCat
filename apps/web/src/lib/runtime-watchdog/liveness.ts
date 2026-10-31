import { RUNTIME_HOST_ERROR_CODE } from "@rowcat/runtime-host/errors";

/**
 * Liveness of a runtime worker, judged by the main thread.
 *
 * - Why: the execution budget is enforced by QuickJS's interrupt handler, which the engine consults
 *   only at bytecode and regex poll points. A single native builtin call never reaches one —
 *   `indexOf` over a long string with a near-matching needle is quadratic and ran for minutes under
 *   a 100 ms budget, reported as success. Nothing inside the worker can cut that turn, and stop and
 *   dispose wait for it to end. So the decision moves to the one thread that can still act: main
 *   asks the worker whether it is there, and terminates it when it stops answering.
 * - What answers: the worker's message handler, which runs only between VM turns. An answer
 *   therefore means "no turn is stuck", and silence past the bound means one is. The bound must
 *   exceed the 1 s execution budget plus host work around a turn by a margin, so a turn the budget
 *   would have cut is never mistaken for a stuck one.
 * - What it is not: polling. Nothing leaves the device. It is one message to a worker this tab
 *   owns, at most once a second, and only while a session runs (not during the preview's compile,
 *   which is synchronous and long by design and runs no creator code).
 * - What is watched is the worker, not a session. Its silence is counted only after the worker has
 *   said it is about to run creator code, and stops counting when it says it is about to be silent
 *   for another reason (see `watchRuntimeWorker`). Main asking for a new session is not one of those
 *   facts: a stuck worker cannot read the request, so a watch that ended there would never come back.
 * - Main being busy is not the worker being stuck. When the bound has passed, the verdict waits one
 *   message turn, so an answer that queued while main was blocked is read before anything is
 *   decided. A background tab whose timers are throttled judges late, never early.
 * - The verdict reuses the budget code: to the person, a work that ran past its time is the same
 *   fact however it ran past it.
 */

export const RUNTIME_LIVENESS_INTERVAL_MS = 1_000;
export const RUNTIME_LIVENESS_TIMEOUT_MS = 5_000;
export const RUNTIME_UNRESPONSIVE_CODE =
	RUNTIME_HOST_ERROR_CODE.executionBudgetExceeded;
/** The host sentence that goes with the code, shared by both hosts so their consoles agree. */
export const RUNTIME_UNRESPONSIVE_MESSAGE = `the runtime did not answer for ${RUNTIME_LIVENESS_TIMEOUT_MS}ms and was ended`;

export interface RuntimeLivenessState {
	/** The ping still waiting for its answer. One at a time. */
	readonly outstanding: {
		readonly seq: number;
		readonly sentAt: number;
	} | null;
	readonly nextSeq: number;
}

export const initialRuntimeLiveness: RuntimeLivenessState = {
	outstanding: null,
	nextSeq: 1,
};

export type RuntimeLivenessStep =
	| { kind: "ping"; seq: number }
	| { kind: "wait" }
	/** The bound has passed. Confirm after one message turn (see above). */
	| { kind: "suspect"; seq: number };

export function runtimeLivenessTick(
	state: RuntimeLivenessState,
	now: number,
	timeoutMs: number = RUNTIME_LIVENESS_TIMEOUT_MS,
): { state: RuntimeLivenessState; step: RuntimeLivenessStep } {
	const { outstanding } = state;
	if (outstanding === null) {
		const seq = state.nextSeq;
		return {
			state: { outstanding: { seq, sentAt: now }, nextSeq: seq + 1 },
			step: { kind: "ping", seq },
		};
	}
	if (now - outstanding.sentAt >= timeoutMs)
		return { state, step: { kind: "suspect", seq: outstanding.seq } };
	return { state, step: { kind: "wait" } };
}

/** An answer clears the ping it answers. An answer to an older ping is ignored. */
export function runtimeLivenessAnswered(
	state: RuntimeLivenessState,
	seq: number,
): RuntimeLivenessState {
	if (state.outstanding === null || seq < state.outstanding.seq) return state;
	return { ...state, outstanding: null };
}

/**
 * Counting starts over from `now`. A ping still waiting was sent before a silence that was not the
 * creator's (a pause), so the time it waited is not evidence; it keeps its number, so a late answer
 * still clears it.
 */
export function runtimeLivenessResumed(
	state: RuntimeLivenessState,
	now: number,
): RuntimeLivenessState {
	if (state.outstanding === null) return state;
	return { ...state, outstanding: { seq: state.outstanding.seq, sentAt: now } };
}

/** True when the suspected ping is still the unanswered one. */
export const runtimeLivenessConfirmed = (
	state: RuntimeLivenessState,
	seq: number,
): boolean => state.outstanding?.seq === seq;

export interface RuntimeLivenessTimers {
	now(): number;
	setTimeout(run: () => void, ms: number): unknown;
	clearTimeout(handle: unknown): void;
	/** Runs `run` after the messages already queued for this thread. */
	afterQueuedMessages(run: () => void): void;
}

const browserTimers = (): RuntimeLivenessTimers => ({
	now: () => performance.now(),
	setTimeout: (run, ms) => setTimeout(run, ms),
	clearTimeout: (handle) =>
		clearTimeout(handle as ReturnType<typeof setTimeout>),
	afterQueuedMessages: (run) => {
		/**
		 * A message task, not a timer: it queues behind the worker's answer if that answer already
		 * arrived, and background-tab timer throttling does not apply to it.
		 */
		const channel = new MessageChannel();
		channel.port1.onmessage = () => {
			channel.port1.close();
			run();
		};
		channel.port2.postMessage(null);
	},
});

export interface RuntimeLivenessWatch {
	/** The worker answered ping `seq`. Accepted while paused too. */
	answered(seq: number): void;
	/** Stops counting until resume(). No ping goes out and no verdict lands, even one already suspected. */
	pause(): void;
	/** Counts again from now (`runtimeLivenessResumed`). Idempotent while counting. */
	resume(): void;
	/** Ends the watch. Idempotent; a verdict never follows a stop. */
	stop(): void;
}

export function watchRuntimeLiveness(options: {
	ping(seq: number): void;
	/** Called at most once. The caller terminates the worker and draws the failure. */
	onUnresponsive(): void;
	timers?: RuntimeLivenessTimers;
	intervalMs?: number;
	timeoutMs?: number;
	/** Starts paused: nothing is sent or counted until resume(). */
	paused?: boolean;
}): RuntimeLivenessWatch {
	const timers = options.timers ?? browserTimers();
	const intervalMs = options.intervalMs ?? RUNTIME_LIVENESS_INTERVAL_MS;
	const timeoutMs = options.timeoutMs ?? RUNTIME_LIVENESS_TIMEOUT_MS;
	let state = initialRuntimeLiveness;
	let stopped = false;
	let paused = options.paused === true;
	/**
	 * Raised by every pause and resume. A suspicion waiting on its message turn belongs to the epoch it
	 * was raised in; across a pause it is void, because the ping it suspects was restamped.
	 */
	let epoch = 0;
	let handle: unknown = null;

	const clear = (): void => {
		if (handle !== null) timers.clearTimeout(handle);
		handle = null;
	};

	const schedule = (): void => {
		handle = timers.setTimeout(tick, intervalMs);
	};

	function tick(): void {
		handle = null;
		if (stopped || paused) return;
		const next = runtimeLivenessTick(state, timers.now(), timeoutMs);
		state = next.state;
		const { step } = next;
		if (step.kind === "ping") options.ping(step.seq);
		if (step.kind !== "suspect") {
			schedule();
			return;
		}
		const suspectedIn = epoch;
		timers.afterQueuedMessages(() => {
			/** A pause or resume in between has already taken over the schedule. */
			if (stopped || epoch !== suspectedIn) return;
			if (!runtimeLivenessConfirmed(state, step.seq)) {
				schedule();
				return;
			}
			stopped = true;
			options.onUnresponsive();
		});
	}

	tick();

	return {
		answered(seq) {
			if (stopped) return;
			state = runtimeLivenessAnswered(state, seq);
		},
		pause() {
			if (stopped || paused) return;
			paused = true;
			epoch += 1;
			clear();
		},
		resume() {
			if (stopped || !paused) return;
			paused = false;
			epoch += 1;
			clear();
			state = runtimeLivenessResumed(state, timers.now());
			tick();
		},
		stop() {
			stopped = true;
			clear();
		},
	};
}

/**
 * What a worker says about itself that changes what its silence means.
 * - `session-starting`: creator code is about to run. Silence from here is what the bound judges.
 *   The worker says it from its own message handling, so its handler is registered by then: a
 *   worker still downloading its script has said nothing and is not judged.
 * - `compiling`: the preview's compile is about to run. It is synchronous, may take seconds and
 *   runs no creator code, so silence through it is not counted.
 * - `session-ended`: no session is left. Nothing in the worker can be stuck.
 *
 * There is deliberately no fact for "main asked for a new session" (`restarting` does nothing).
 * Asking changes nothing in the worker; if a turn is stuck, the worker cannot even read the request,
 * and its next fact never comes. A watch that stopped at the request waited for that fact forever.
 * The order of facts is the worker's: it ends the old session before compiling the new one, so a
 * healthy restart still pauses before its compile and only a stuck one runs out the bound.
 */
export type RuntimeWorkerFact =
	| "session-starting"
	| "compiling"
	| "session-ended";

export interface RuntimeWorkerWatch {
	/**
	 * The worker said `fact`. Facts from any session count — the worker is one thread for all of them
	 * — except one older than a session the worker has already announced. Not every fact rides the
	 * worker's chain: a session that dies in an effect reports `failed` outside it, so `failed(N)` can
	 * arrive after `starting(N + 1)`, and pausing on it left the newer session's creator code unwatched.
	 * Generations only rise, so `generation` is enough to tell; a caller with one session per worker
	 * may leave it out.
	 */
	observe(fact: RuntimeWorkerFact, generation?: number): void;
	/** Main asked the worker for a new session. Changes nothing; see `RuntimeWorkerFact`. */
	restarting(): void;
	answered(seq: number): void;
	stop(): void;
}

/** One watch for the worker's whole life, starting paused: the worker has said nothing yet. */
export function watchRuntimeWorker(
	options: Omit<Parameters<typeof watchRuntimeLiveness>[0], "paused">,
): RuntimeWorkerWatch {
	const watch = watchRuntimeLiveness({ ...options, paused: true });
	let latest = Number.NEGATIVE_INFINITY;
	return {
		observe(fact, generation) {
			if (generation !== undefined) {
				if (generation < latest) return;
				latest = generation;
			}
			if (fact === "session-starting") watch.resume();
			else watch.pause();
		},
		restarting() {},
		answered: (seq) => watch.answered(seq),
		stop: () => watch.stop(),
	};
}
