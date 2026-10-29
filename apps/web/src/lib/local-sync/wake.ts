import type { SyncController } from "@rowcat/sync";
import { syncFailureOf } from "@rowcat/sync";
import type { WebAutoSync } from "./auto-sync.ts";
import type { SyncWakeStream } from "./transport.ts";

/**
 * Web lifecycle manager for the wake stream. It owns the connection only, never the sync.
 * - Boundaries: @rowcat/sdk decides how to open (paths, credentials, SSE framing). This file
 *   decides when to open and close, when to reconnect, and whom to hand the wake to. @rowcat/sync
 *   decides what runs on a wake (debounce, single run, one follow-up, backoff).
 * - The only bridge is autoSync.requestSync("remote-wake"). Never call controller.syncNow(),
 *   engine.pull(), or transport.pull() from here. Doing so creates a second run path that bypasses
 *   single-run, backoff, and account isolation.
 * - Not here, and why: - Local cursor writes. This file only reads the cursor (see
 *   readLocalCursor). Only the pull plus applyPull transaction may move the cursor. - Toasts or
 *   indicators. Remote changes should be invisible. The screen updates through IndexedDB liveQuery,
 *   and a dropped connection is information the user cannot act on. - A separate toggle. SSE is
 *   part of auto sync; the user has no reason to understand the transport. - Periodic polling.
 *   Heartbeats are server comments; this file requests nothing on a timer. - Leader election or
 *   BroadcastChannel. There is one stream per tab (see Multiple tabs).
 * - Connection state and sync state are separate axes. A dropped SSE stream is not a failed
 *   encrypted sync, so this file never touches SyncController.lastError or the auto-sync phase.
 *   Start, foreground, reconnect, and manual sync keep working while the stream is down. That is
 *   what makes SSE an optimization.
 * - Multiple tabs: one stream per tab. A Web Lock that lets only one tab connect would save
 *   connections, but it adds leader-death detection and handoff. Duplicate runs are already reduced
 *   by withSyncLock, and other tabs already see remote changes through IndexedDB liveQuery. Revisit
 *   if the connection count becomes a real problem.
 */

/**
 * Reconnect delay: capped exponential backoff. It stops at the last value and never gives up.
 * Giving up would leave the device slow to learn about remote changes until it is turned back on,
 * with no way for the user to know.
 */
const BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;

/**
 * The threshold for calling a connection healthy. Without it, backoff is useless: a server or proxy
 * that sends only the initial frame and closes would reset the counter on every frame, reconnecting
 * about once a second. Only connections that live past the heartbeat interval (20 seconds) count.
 */
const HEALTHY_MS = 30_000;

/**
 * Jitter width, so browsers that disconnected at the same moment do not all reconnect together.
 */
const JITTER = 0.25;

export interface SyncWakeTimers {
	setTimeout(handler: () => void, ms: number): unknown;
	clearTimeout(handle: unknown): void;
	now(): number;
	random(): number;
}

const systemTimers: SyncWakeTimers = {
	setTimeout: (handler, ms) => setTimeout(handler, ms),
	clearTimeout: (handle) =>
		clearTimeout(handle as ReturnType<typeof setTimeout>),
	now: () => Date.now(),
	random: () => Math.random(),
};

export interface WebSyncWakeOptions {
	controller: SyncController;
	autoSync: WebAutoSync;
	open: SyncWakeStream;
	/**
	 * The cursor this device has already applied. Read-only; null on failure is acceptable. This is a
	 * pure network optimization. If the remote cursor is not greater than the local one, there is
	 * nothing to pull and the wake is skipped. When unsure, wake: one wasted pull is one round trip,
	 * while a missed remote change is never noticed by the user.
	 */
	readLocalCursor: () => Promise<number>;
	/**
	 * Whether this scope is still owned by this device right now. Callbacks left over after an account
	 * switch must not wake someone else's sync.
	 */
	ownsStore: () => boolean;
	/**
	 * Browser-reported connectivity. Defaults to navigator.onLine. Like AutoSyncTarget.isOnline, this
	 * is a hint, not reachability. It does one thing: when false, the reconnect timer is not
	 * continued.
	 */
	isOnline?: () => boolean;
	timers?: SyncWakeTimers;
	backoffMs?: readonly number[];
	healthyMs?: number;
}

export interface WebSyncWake {
	/**
	 * Attaches the signal and connects if the conditions allow. Idempotent, because of StrictMode's
	 * double mount.
	 */
	start(): void;
	/**
	 * Disconnects and detaches the signal. This instance is never reused; a new scope gets a new
	 * instance.
	 */
	stop(): void;
	/** Whether the stream is open right now. A value for tests to read, not for the screen. */
	connected(): boolean;
}

export function createWebSyncWake(options: WebSyncWakeOptions): WebSyncWake {
	const {
		controller,
		autoSync,
		open,
		readLocalCursor,
		ownsStore,
		isOnline = () =>
			typeof navigator === "undefined" || navigator.onLine !== false,
		timers = systemTimers,
		backoffMs = BACKOFF_MS,
		healthyMs = HEALTHY_MS,
	} = options;

	let started = false;
	/**
	 * Generation of the connection procedure. When the connection is torn down and rebuilt (start →
	 * stop → start from StrictMode, or a condition change), a late continuation of the first procedure
	 * must not carry on as if it were the second. Auto sync guards against the same trap the same way.
	 */
	let generation = 0;
	let abort: AbortController | null = null;
	let retryTimer: unknown = null;
	let failures = 0;
	/** Whether the connection procedure (stream plus reconnect wait) is alive. */
	let running = false;
	/** Whether frames are being received right now. False during the reconnect wait. */
	let streaming = false;
	/**
	 * Handle that wakes the pending reconnect timer immediately, so cleanup never leaves a promise
	 * hanging.
	 */
	let releaseRetry: (() => void) | null = null;
	/**
	 * Hit a failure that retrying cannot fix (401 or 403). Do not retry: the same request gets the
	 * same answer, and meanwhile only battery is spent. When the session really returns, the scope is
	 * rebuilt and a new instance starts then.
	 */
	let blocked = false;
	let detach: (() => void) | null = null;

	/**
	 * Whether the stream should be open. All four conditions must hold:
	 * - This scope is still owned by this device (no ghost connection after an account switch).
	 * - The controller is trusted (a wake cannot pull while the key is unset or locked).
	 * - Auto sync is enabled (otherwise a wake accomplishes nothing).
	 * - The browser is online (no reconnect attempts while offline). Only `trusted` is checked, not
	 *   `state`. State becomes `syncing` during every sync, and including it would reconnect the
	 *   stream on every sync. Whether the key is in memory (`trusted`) is what decides whether the
	 *   connection is useful.
	 */
	const shouldConnect = (): boolean =>
		started &&
		!blocked &&
		ownsStore() &&
		isOnline() &&
		autoSync.snapshot().enabled &&
		controller.snapshot().trusted;

	/**
	 * Cancels the wait by waking it. Clearing only the timer would leave the await unresolved forever,
	 * pinning the closure of that connection procedure, including its abort controller. Waking it lets
	 * the generation check reject it, so cleanup completes.
	 */
	const clearRetry = (): void => {
		if (retryTimer !== null) {
			timers.clearTimeout(retryTimer);
			retryTimer = null;
		}
		const release = releaseRetry;
		releaseRetry = null;
		release?.();
	};

	const disconnect = (): void => {
		generation++;
		clearRetry();
		abort?.abort();
		abort = null;
		streaming = false;
		running = false;
	};

	/**
	 * Re-evaluates every time a condition changes. Starting again resets the backoff count from zero.
	 */
	const evaluate = (): void => {
		if (shouldConnect()) {
			if (running) return;
			failures = 0;
			void connect(++generation);
			return;
		}
		if (running || retryTimer !== null) disconnect();
	};

	const delay = (ms: number): Promise<void> =>
		new Promise((resolve) => {
			releaseRetry = resolve;
			retryTimer = timers.setTimeout(() => {
				retryTimer = null;
				releaseRetry = null;
				resolve();
			}, ms);
		});

	const backoffFor = (attempt: number): number => {
		const base = backoffMs[Math.min(attempt, backoffMs.length - 1)] ?? 1_000;
		return Math.round(base * (1 + (timers.random() * 2 - 1) * JITTER));
	};

	/**
	 * Handles one wake by handing it to the coordinator, and nothing more. Whether it is in backoff,
	 * already running, or blocked is not decided here. The coordinator already holds those rules, and
	 * deciding again here would create two copies that eventually diverge.
	 */
	async function handle(cursor: number, claimed: number): Promise<void> {
		let local: number | null = null;
		try {
			local = await readLocalCursor();
		} catch {
			// The database is closed or could not be read. When unsure, the wake goes through.
			local = null;
		}
		// The account may have changed during the round trip, or this procedure may be stale.
		if (claimed !== generation || !started || !ownsStore()) return;
		if (local !== null && cursor <= local) return;
		autoSync.requestSync("remote-wake");
	}

	async function connect(claimed: number): Promise<void> {
		running = true;
		try {
			while (claimed === generation && started && !blocked) {
				const controllerAbort = new AbortController();
				abort = controllerAbort;
				const openedAt = timers.now();

				try {
					streaming = true;
					for await (const event of open(controllerAbort.signal)) {
						if (claimed !== generation || !started) return;
						await handle(event.cursor, claimed);
					}
					// The server closed the stream. That is not an error, but the stream must reconnect.
				} catch (error) {
					if (claimed !== generation || !started) return;
					const failure = syncFailureOf(error);
					/**
					 * 401 and 403 do not resolve with backoff. Either the login was revoked or the account is
					 * blocked, and retrying is not the answer in either case. The session lifetime holds that
					 * answer, so the scope is rebuilt completely at that point.
					 */
					if (failure.status === 401 || failure.status === 403) {
						blocked = true;
						return;
					}
				}

				streaming = false;
				if (claimed !== generation || !started) return;
				/**
				 * A connection that stayed alive past the heartbeat proves the path is healthy, so the counter
				 * resets regardless of how the connection ended. The most common end of a long-lived connection
				 * is a network-change error. Counting it as a failure would inherit failures from hours earlier
				 * and make the first reconnect wait 30 seconds. Only short-lived connections accumulate
				 * backoff.
				 */
				if (timers.now() - openedAt >= healthyMs) failures = 0;
				const wait = backoffFor(failures);
				failures += 1;
				await delay(wait);
			}
		} finally {
			if (claimed === generation) {
				streaming = false;
				running = false;
			}
		}
	}

	return {
		start() {
			if (started) return;
			started = true;

			const onOnline = (): void => evaluate();
			const onOffline = (): void => evaluate();
			const unsubscribeController = controller.subscribe(evaluate);
			const unsubscribeAuto = autoSync.subscribe(evaluate);
			if (typeof window !== "undefined") {
				window.addEventListener("online", onOnline);
				window.addEventListener("offline", onOffline);
			}
			detach = () => {
				unsubscribeController();
				unsubscribeAuto();
				if (typeof window !== "undefined") {
					window.removeEventListener("online", onOnline);
					window.removeEventListener("offline", onOffline);
				}
			};

			evaluate();
		},

		stop() {
			if (!started) return;
			started = false;
			detach?.();
			detach = null;
			/**
			 * Cleanup is final. On logout, account switch, or withdrawal, this instance ends here and is
			 * never revived. The in-flight for-await is ended by abort, and late events are dropped by the
			 * generation check. That is why no path exists for Alice's stream to wake Bob's sync.
			 */
			disconnect();
		},

		connected: () => streaming,
	};
}
