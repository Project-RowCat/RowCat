import { SYNC_ERROR_CODE } from "@rowcat/contracts/sync";
import { syncFailureOf } from "./transport.ts";

/**
 * The auto-sync scheduler. It knows when a sync runs, not what a sync does: debounce, single-run,
 * one follow-up run, and backoff. Serialization, compression, encryption, push, pull, cursors,
 * merge, and tombstones belong to the engine and are not repeated here. If auto-sync touched the
 * protocol it would become a new protocol, and the agreement between two devices would break.
 *
 * Deliberately absent:
 * - window, document, navigator, React, Dexie. The trigger sources differ per platform (web:
 *   visibilitychange, focus, online; Expo: AppState, NetInfo). Putting them here would create two
 *   copies of the same state machine, and the copies would drift apart.
 * - Periodic polling (setInterval). A quiet app making no network calls is the V1 promise.
 *   Latency for remote changes is reduced by the SSE wake-up in the next slice; polling now would
 *   make that slice's problem look already solved.
 * - Error messages and toasts. Failures are classified only (AutoSyncErrorCategory). An auto-sync
 *   failure is not something the user did, so usually nothing is shown.
 * - Records, ids, plaintext. A signal carries only 'something changed' (which is why
 *   notifyLocalChange() takes no argument). The scheduling layer has no reason to hold user data.
 *
 * Time is injected too. Not calling Date.now() or the global setTimeout is a contract, not a
 * default. Every rule in this file concerns time, and without injection a 1-second debounce test
 * would take a real second.
 */

/**
 * The source of a trigger. Diagnostic only. It does not affect merging, what gets sent, or the
 * pull/push order. If each reason started a different sync (for example 'focus pulls only'),
 * conflict handling would split by reason, and each split would re-solve a problem the engine has
 * already solved once.
 *
 * `remote-wake` exists in advance as the junction point for the next slice (SSE). When a server
 * bump arrives, that adapter calls `requestSync('remote-wake')` on one line, and this file is not
 * changed.
 */
export type SyncReason =
	| "startup"
	| "local"
	| "focus"
	| "visible"
	| "online"
	| "manual"
	| "unlocked"
	| "enabled"
	| "follow-up"
	| "retry"
	| "remote-wake";

/**
 * What the scheduler is doing right now. Several booleans (isRunning, hasPending, isBackingOff) are
 * avoided because some combinations are unreachable. 'Running while backing off' is meaningless,
 * yet a boolean-based type would allow it.
 */
export type AutoSyncPhase =
	| "idle"
	/** A debounce, absorption-window, or backoff timer is set. */
	| "scheduled"
	| "syncing"
	/** Waiting after a transient failure. A timer is set. */
	| "backoff"
	/** The browser reports being offline. No timer is set (§52). */
	| "offline"
	/** Cannot run now: not configured, locked, turned off, or a failure that retrying will not fix. */
	| "blocked"
	| "stopped";

/**
 * The failure category. It is the only axis that decides whether a retry is worthwhile. Exception
 * messages are not kept. A server-supplied sentence could someday contain a record id or a user
 * value; if it entered the state it would reach the screen, not only the logs.
 */
export type AutoSyncErrorCategory =
	| "network"
	| "server"
	| "unauthorized"
	| "crypto"
	| "invalid_payload"
	| "unknown";

export interface AutoSyncStatus {
	phase: AutoSyncPhase;
	/** When the last run that actually executed finished, per the injected clock. Null if none. */
	lastSuccessAt: number | null;
	errorCategory: AutoSyncErrorCategory | null;
	/** Reason for the current schedule or run. Diagnostic only. */
	reason: SyncReason | null;
}

export type AutoSyncOutcome =
	| { status: "ok" }
	/**
	 * Did not run: locked, turned off, or another tab holds the lock. This is not a failure (a
	 * different axis from §139).
	 */
	| { status: "skipped" }
	| { status: "failed"; category: AutoSyncErrorCategory };

/**
 * The execution target: everything this layer knows about sync. `run()` returns a boolean rather
 * than `SyncRunResult` on purpose. The scheduler does not need to know how many items moved (zero
 * is also success). If it knew, a rule like 'do not run again when zero items moved' would creep in
 * here, which contradicts the fact that pull is the only way to discover remote changes.
 */
export interface AutoSyncTarget {
	/** Whether it can run now: configured, unlocked, and the scope still belongs to this instance. */
	canRun(): boolean | Promise<boolean>;
	/**
	 * Runs once. `false` means it did not run, which is not a failure and creates no backoff. A thrown
	 * error is a failure, and `classifyAutoSyncFailure` classifies it.
	 */
	run(): Promise<boolean>;
	/**
	 * The browser's view of connectivity. If absent, treated as always online. This is a hint, not
	 * reachability (§36). It can be true while the API is down, and then transport errors are
	 * authoritative. Its only effect: when false, timers are not kept going.
	 */
	isOnline?(): boolean;
}

/** Time port. Injected so tests can drive the clock. */
export interface AutoSyncTimers {
	setTimeout(handler: () => void, ms: number): unknown;
	clearTimeout(handle: unknown): void;
	now(): number;
}

const systemTimers: AutoSyncTimers = {
	setTimeout: (handler, ms) => setTimeout(handler, ms),
	clearTimeout: (handle) =>
		clearTimeout(handle as ReturnType<typeof setTimeout>),
	now: () => Date.now(),
};

/**
 * Debounce for local edits, measured from the trailing edge. Why 1 second: messages are committed
 * one at a time, so they should not be batched long; the peer's receive delay would grow with the
 * batch. Draft autosaves arrive in bursts and should collapse into one run. Tens of seconds would
 * delay changes from a user about to close the tab; 0 would turn each typed character into a round
 * trip.
 */
const LOCAL_DEBOUNCE_MS = 1_000;

/**
 * Absorption window for lifecycle signals. `visibilitychange` and `focus` fire together when the
 * user returns to the window once. Without the window, that single return would cause two round
 * trips.
 */
const LIFECYCLE_WINDOW_MS = 200;

/**
 * Wait after a transient failure: capped exponential backoff. It stops at the last value and never
 * gives up. If auto-sync gave up, this device's changes would stay only on this device until the
 * user found and pressed the sync button, and they would have no way to know that.
 */
const BACKOFF_MS = [5_000, 15_000, 30_000, 60_000] as const;

/**
 * Whether a failure is worth retrying. 401, 403, crypto, and invalid-payload errors get the same
 * answer no matter how often the request is resent. Running them through backoff only drains the
 * battery, and the real problem (sign in again, unlock) never reaches the user.
 */
const isRetryable = (category: AutoSyncErrorCategory): boolean =>
	category === "network" || category === "server" || category === "unknown";

/**
 * Maps an error to a category, reusing what `syncFailureOf` in the transport port already does. One
 * place checks the code before the status: client-only codes such as `sync_locked` have status 0,
 * so they would otherwise read as network failures. A locked device would then retry every 5
 * seconds.
 */
export function classifyAutoSyncFailure(error: unknown): AutoSyncErrorCategory {
	const failure = syncFailureOf(error);
	if (
		failure.code === SYNC_ERROR_CODE.locked ||
		failure.code === SYNC_ERROR_CODE.keyringProofInvalid ||
		failure.code === SYNC_ERROR_CODE.keyringMissing
	)
		return "crypto";
	if (
		failure.code === SYNC_ERROR_CODE.recordInvalid ||
		failure.code === SYNC_ERROR_CODE.cursorInvalid ||
		failure.code === SYNC_ERROR_CODE.idempotencyMismatch
	)
		return "invalid_payload";
	if (failure.status === 0) return "network";
	if (failure.status === 401 || failure.status === 403) return "unauthorized";
	if (failure.status === 408 || failure.status === 429) return "server";
	if (failure.status >= 500) return "server";
	if (failure.status >= 400) return "invalid_payload";
	return "unknown";
}

export interface AutoSyncOptions {
	target: AutoSyncTarget;
	timers?: AutoSyncTimers;
	localDebounceMs?: number;
	lifecycleWindowMs?: number;
	backoffMs?: readonly number[];
}

export interface AutoSyncCoordinator {
	/** Called after a local change is committed. Subject to the debounce. */
	notifyLocalChange(): void;
	/**
	 * Lifecycle signals: startup, foreground, reconnect, unlock, SSE wake-up. Subject to the short
	 * absorption window.
	 */
	requestSync(reason?: SyncReason): void;
	/**
	 * Runs once now, for the manual sync button. Resolves with the result of a run that starts after
	 * this call. If a run is in progress, it waits for the follow-up run instead of rejecting with "already
	 * syncing" (§44). It runs even when auto-sync is off: turning that off disables automatic
	 * triggers, not the user's button.
	 */
	runNow(): Promise<AutoSyncOutcome>;
	/** Permanent stop. This instance is never reused; a new scope gets a new instance. */
	stop(): void;
	status(): AutoSyncStatus;
	subscribe(listener: () => void): () => void;
}

export function createAutoSyncCoordinator(
	options: AutoSyncOptions,
): AutoSyncCoordinator {
	const {
		target,
		timers = systemTimers,
		localDebounceMs = LOCAL_DEBOUNCE_MS,
		lifecycleWindowMs = LIFECYCLE_WINDOW_MS,
		backoffMs = BACKOFF_MS,
	} = options;

	let stopped = false;
	/** Whether a run is in progress. This boolean is the entire single-run invariant. */
	let running = false;
	/**
	 * A request that arrives during a run is recorded as one reason, not a count. A queue would turn
	 * 20 triggers into 20 runs. One follow-up run collects all the dirty records that built up
	 * meanwhile, because collection scans the store rather than the queue. Counting is wasted work.
	 */
	let queued: SyncReason | null = null;

	let timer: unknown = null;
	/** Scheduled run time. Only an earlier request moves it forward. */
	let scheduledAt = 0;
	let scheduledReason: SyncReason | null = null;
	/** Which axis the schedule came from: local edits push it later, signals pull it earlier. */
	let scheduledKind: "local" | "signal" = "signal";
	/**
	 * Backoff floor. Local changes cannot move this time earlier (§54). If they could, typing during
	 * repeated failures would keep reviving retries, effectively erasing the backoff.
	 */
	let notBefore = 0;
	let failures = 0;

	let status: AutoSyncStatus = {
		phase: "idle",
		lastSuccessAt: null,
		errorCategory: null,
		reason: null,
	};
	const listeners = new Set<() => void>();
	/** Manual calls waiting for the outcome of the next run. */
	let waiting: Array<(outcome: AutoSyncOutcome) => void> = [];

	const publish = (patch: Partial<AutoSyncStatus>): void => {
		status = { ...status, ...patch };
		for (const listener of listeners) listener();
	};

	const clearTimer = (): void => {
		if (timer === null) return;
		timers.clearTimeout(timer);
		timer = null;
		scheduledAt = 0;
	};

	const settle = (
		pending: Array<(outcome: AutoSyncOutcome) => void>,
		outcome: AutoSyncOutcome,
	): void => {
		for (const resolve of pending) resolve(outcome);
	};

	/**
	 * Schedules a run. There is always exactly one timer. The two axes move differently:
	 * - local: the trailing edge of the debounce. It keeps pushing the time later while edits
	 *   continue.
	 * - signal: lifecycle, manual, and retry. The earlier time wins.
	 *
	 * So a foreground signal arriving during a local debounce yields a single run: the signal pulls
	 * the time forward and the run also picks up the edits (§103), and no stale debounce fires later.
	 * In the other direction, a local edit never pushes a signal's schedule later. Doing so would keep
	 * postponing the run that the user's return triggered.
	 */
	function schedule(
		reason: SyncReason,
		delayMs: number,
		kind: "local" | "signal",
		phase: AutoSyncPhase = "scheduled",
	): void {
		if (stopped) return;
		if (running) {
			// If a run is in progress, this becomes one follow-up run instead of a schedule. The first
			// reason received is kept for diagnostics.
			queued ??= reason;
			return;
		}
		const now = timers.now();
		let at = now + delayMs;
		if (kind === "local") {
			if (at < notBefore) at = notBefore;
			if (timer !== null && scheduledKind === "signal") return;
		} else {
			/*
			 * User actions and lifecycle signals break the backoff (§55). Someone who landed and reopened
			 * the app has no reason to wait out the remaining 60 seconds. If the failure continues, the next
			 * backoff is set again.
			 */
			if (reason !== "retry") notBefore = 0;
			if (timer !== null && scheduledAt <= at) return;
		}
		clearTimer();
		scheduledAt = at;
		scheduledKind = kind;
		scheduledReason = reason;
		timer = timers.setTimeout(
			() => {
				void fire();
			},
			Math.max(0, at - now),
		);
		publish({ phase, reason });
	}

	async function fire(): Promise<void> {
		timer = null;
		scheduledAt = 0;
		const reason = scheduledReason ?? "local";
		scheduledReason = null;
		if (stopped) return;
		if (running) {
			queued ??= reason;
			return;
		}

		/*
		 * When offline, no timer is kept (§52). The next run is triggered by `online`. Rescheduling here
		 * would turn three hours in airplane mode into hundreds of retries.
		 */
		if (target.isOnline && !target.isOnline()) {
			settle(takeWaiting(), { status: "skipped" });
			publish({ phase: "offline", reason });
			return;
		}

		let allowed: boolean;
		try {
			allowed = await target.canRun();
		} catch {
			allowed = false;
		}
		if (stopped) return;
		if (!allowed) {
			/*
			 * Not configured, locked, or turned off. Passes silently: it does not prompt for the recovery
			 * code in the background, and it does not create settings on the user's behalf. When the state
			 * changes (unlock, toggle), that path calls `requestSync`.
			 */
			settle(takeWaiting(), { status: "skipped" });
			publish({ phase: "blocked", reason });
			return;
		}
		await execute(reason);
	}

	const takeWaiting = (): Array<(outcome: AutoSyncOutcome) => void> => {
		const pending = waiting;
		waiting = [];
		return pending;
	};

	async function execute(reason: SyncReason): Promise<void> {
		running = true;
		queued = null;
		const pending = takeWaiting();
		publish({ phase: "syncing", reason });

		let outcome: AutoSyncOutcome;
		try {
			outcome = (await target.run()) ? { status: "ok" } : { status: "skipped" };
		} catch (error) {
			outcome = { status: "failed", category: classifyAutoSyncFailure(error) };
		}
		running = false;
		settle(pending, outcome);

		/*
		 * Nothing is scheduled after stop (§75). This is the last guard during an account switch. The
		 * request has already gone out and the response has arrived, but its completion must not create
		 * another run, because that run would execute in another member's scope.
		 */
		if (stopped) return;

		if (outcome.status === "failed") {
			onFailure(outcome.category, reason);
			return;
		}

		failures = 0;
		notBefore = 0;
		if (outcome.status === "ok") {
			// A sync that moved zero items is still a success (§139): the backoff resets and the last
			// success time advances.
			publish({ lastSuccessAt: timers.now(), errorCategory: null });
		}

		const follow = queued;
		queued = null;
		if (follow) {
			/*
			 * A follow-up run must cross an async boundary (§130). Calling `execute` directly here would
			 * grow the stack while signals keep arriving, and nothing else would get to run in the meantime.
			 */
			schedule("follow-up", 0, "signal");
			return;
		}
		publish({ phase: "idle", reason: null });
	}

	function onFailure(
		category: AutoSyncErrorCategory,
		reason: SyncReason,
	): void {
		publish({ errorCategory: category });
		queued = null;
		if (!isRetryable(category)) {
			// Retrying will not fix this (§56). When the state changes, that path calls again.
			publish({ phase: "blocked", reason });
			return;
		}
		failures = Math.min(failures + 1, backoffMs.length);
		const delay = backoffMs[failures - 1] ?? backoffMs[backoffMs.length - 1];
		notBefore = timers.now() + delay;
		schedule("retry", delay, "signal", "backoff");
	}

	return {
		notifyLocalChange() {
			schedule("local", localDebounceMs, "local");
		},

		requestSync(reason = "startup") {
			schedule(reason, lifecycleWindowMs, "signal");
		},

		runNow() {
			if (stopped)
				return Promise.resolve<AutoSyncOutcome>({ status: "skipped" });
			const promise = new Promise<AutoSyncOutcome>((resolve) => {
				waiting.push(resolve);
			});
			schedule("manual", 0, "signal");
			return promise;
		},

		stop() {
			if (stopped) return;
			stopped = true;
			clearTimer();
			scheduledReason = null;
			queued = null;
			/*
			 * Does not leave waiting manual calls hanging. If the promise of a user who pressed the button
			 * at the moment of logout never resolved, that screen would stay `busy` forever.
			 */
			settle(takeWaiting(), { status: "skipped" });
			publish({ phase: "stopped", reason: null });
		},

		status: () => status,

		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}
