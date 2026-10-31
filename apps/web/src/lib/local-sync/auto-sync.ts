import type {
	AutoSyncOutcome,
	AutoSyncStatus,
	SyncController,
	SyncReason,
} from "@rowcat/sync";
import { createAutoSyncCoordinator, SYNC_LOGIN_REQUIRED } from "@rowcat/sync";
import type { LocalMutationSignal } from "#/lib/local-data/mutation-signal.ts";
import type { AutoSyncPreferenceStore } from "./preference.ts";

/**
 * Web adapter for auto-sync. This file holds no schedule. It supplies only the signals.
 * - @rowcat/sync decides when to run: debounce, single run, one follow-up, backoff.
 * - This file decides what wakes it: visibilitychange, focus, online, local writes.
 *
 * A future Expo version rewrites only this file (AppState, NetInfo). Browser events must not go
 * into the shared package, or the same state machine would exist twice and eventually drift.
 *
 * Deliberately absent:
 * - Periodic timer. There is no setInterval, so a quiet app makes no requests. Latency for remote
 *   changes is cut by SSE wake (a later step), which adds one requestSync('remote-wake') call.
 * - beforeunload, pagehide, sendBeacon. An encrypted round trip cannot finish as the tab closes,
 *   and none is needed: dirty stays on disk and the next start uploads it.
 * - Service Worker or Background Sync. Browser support is uneven and the design does not require
 *   it.
 * - Toasts. An auto-sync failure is not something the user did, so usually nothing is shown.
 */

export interface AutoSyncSnapshot extends AutoSyncStatus {
	enabled: boolean;
}

export interface WebAutoSyncOptions {
	controller: SyncController;
	/**
	 * Inputs to the lock name. Because viewerId is part of it, switching accounts yields a different
	 * lock.
	 */
	viewerId: string;
	mutations: LocalMutationSignal;
	preference: AutoSyncPreferenceStore;
	/**
	 * Whether this store still belongs to the active scope. It is asked again right before every run.
	 * The reason is account switching: a timer left over from Alice (logout, then Bob signs in) can
	 * wake and run under Bob's scope, carrying Alice's cursor and keys.
	 */
	ownsStore: () => boolean;
	/**
	 * Scheduling time constants. When omitted, the shared defaults apply (1s local debounce, 200ms
	 * lifecycle signal). Exposed for tests. With the defaults, checking that browser signals reach the
	 * coordinator would take a real second. The rules for these values live in the shared package.
	 * This file only injects them.
	 */
	timing?: { localDebounceMs?: number; lifecycleWindowMs?: number };
}

export interface WebAutoSync {
	/**
	 * Attaches the browser signals and requests a start-up sync. Idempotent, because StrictMode mounts
	 * twice.
	 */
	start(): void;
	/**
	 * Detaches the signals and stops the coordinator permanently. Calling start() again creates a new
	 * instance.
	 */
	stop(): void;
	/**
	 * Manual button. Runs even when auto-sync is off. It goes through the same gate as automatic runs.
	 */
	runManualSync(): Promise<AutoSyncOutcome>;
	/** Call this when a sync becomes runnable, for example right after unlock or a settings change. */
	requestSync(reason: SyncReason): void;
	setEnabled(enabled: boolean): Promise<void>;
	snapshot(): AutoSyncSnapshot;
	subscribe(listener: () => void): () => void;
}

const IDLE: AutoSyncStatus = {
	phase: "idle",
	lastSuccessAt: null,
	errorCategory: null,
	reason: null,
};

export function createWebAutoSync(options: WebAutoSyncOptions): WebAutoSync {
	const { controller, viewerId, mutations, preference, ownsStore, timing } =
		options;

	let coordinator: ReturnType<typeof createAutoSyncCoordinator> | null = null;
	let unsubscribeCoordinator: (() => void) | null = null;
	let detach: (() => void) | null = null;
	let started = false;
	/**
	 * Generation of the start procedure. In start → stop → start (StrictMode), a late step from the
	 * first start must not continue as if it belonged to the second.
	 */
	let generation = 0;
	let enabled = true;
	/**
	 * The value useSyncExternalStore reads. It must be the same reference when nothing changed.
	 * Creating a new object on every read would keep re-renders from ever settling.
	 */
	let snapshot: AutoSyncSnapshot = { ...IDLE, enabled };
	const listeners = new Set<() => void>();

	const publish = (next: AutoSyncSnapshot): void => {
		snapshot = next;
		for (const listener of listeners) listener();
	};

	const republish = (): void =>
		publish({ ...(coordinator?.status() ?? IDLE), enabled });

	/**
	 * Creates the coordinator once, on first need. Not during render: if it were created in render and
	 * stopped in the effect cleanup, React's double mount would permanently stop the live instance,
	 * and nothing would run afterwards. The same trap is noted in the provider.tsx header.
	 */
	function ensure(): ReturnType<typeof createAutoSyncCoordinator> {
		if (coordinator) return coordinator;
		const created = createAutoSyncCoordinator({
			...(timing?.localDebounceMs !== undefined
				? { localDebounceMs: timing.localDebounceMs }
				: {}),
			...(timing?.lifecycleWindowMs !== undefined
				? { lifecycleWindowMs: timing.lifecycleWindowMs }
				: {}),
			target: {
				/**
				 * Three conditions must hold to run: this scope is still ours, this device holds the key, and
				 * the controller is in a runnable state.
				 *
				 * The auto toggle is deliberately not checked here. Turning auto-sync off stops automatic
				 * triggers, not the user's button. Checking it here would make the user's `Sync now` silently do
				 * nothing after they turned the toggle off.
				 */
				canRun: () => {
					if (!ownsStore()) return false;
					const state = controller.snapshot();
					return (
						state.trusted &&
						(state.state === "ready" || state.state === "error")
					);
				},
				/**
				 * navigator.onLine is a hint, not reachability. It can be true while the API is down, and then
				 * the authority is the transport error (backoff). This value does one thing: it keeps retry
				 * timers from continuing while offline, such as in airplane mode.
				 */
				isOnline: () =>
					typeof navigator === "undefined" || navigator.onLine !== false,
				run: async () => {
					const ran = await withSyncLock(viewerId, async () => {
						const result = await controller.syncNow();
						// null means the device has no key, so nothing ran. That is not a failure.
						return result !== null;
					});
					// Failing to take the lock (another tab holds it) is not a failure either.
					return ran === true;
				},
			},
		});
		coordinator = created;
		unsubscribeCoordinator = created.subscribe(republish);
		return created;
	}

	/** Automatic triggers pass through the toggle. The manual path (runManualSync) does not. */
	/**
	 * A check that found someone else's session (`login_required`, not trusted) leaves nothing that
	 * can run, and when the owner's session comes back in another tab the scope does not change, so
	 * nothing would ask again. A lifecycle signal therefore checks again first; a run scheduled
	 * instead would only be refused by `canRun`.
	 */
	let rechecking = false;
	const awaitingOwner = (): boolean => {
		const state = controller.snapshot();
		return (
			!state.trusted &&
			state.state === "error" &&
			state.lastError === SYNC_LOGIN_REQUIRED
		);
	};

	const requestAuto = (reason: SyncReason): void => {
		if (!started) return;
		/**
		 * Before the toggle: a re-check is a read that settles state, not an automatic run, and with
		 * automatic sync off this tab would otherwise have no way out but a reload (the screen draws no
		 * button for this state). Only the run after it follows the toggle. Not at start-up: that
		 * request follows the check that just ran.
		 */
		if (reason !== "startup" && awaitingOwner()) {
			if (rechecking) return;
			rechecking = true;
			const claimed = generation;
			void controller
				.inspect()
				.then(() => {
					if (claimed === generation && started && enabled && ownsStore())
						ensure().requestSync(reason);
				})
				.catch(() => undefined)
				.finally(() => {
					rechecking = false;
				});
			return;
		}
		if (!enabled) return;
		ensure().requestSync(reason);
	};

	function disposeCoordinator(): void {
		unsubscribeCoordinator?.();
		unsubscribeCoordinator = null;
		coordinator?.stop();
		coordinator = null;
	}

	return {
		start() {
			if (started) return;
			started = true;
			const claimed = ++generation;

			/**
			 * visibilitychange and focus fire together when the user returns to the window once. Merging
			 * them is the job of the coordinator's absorption window, so events pass through unfiltered
			 * here. Filtering again here would create the same rule in two places.
			 */
			const onVisibility = (): void => {
				if (document.visibilityState === "visible") requestAuto("visible");
			};
			const onFocus = (): void => requestAuto("focus");
			const onOnline = (): void => requestAuto("online");
			const onMutation = (): void => {
				if (!enabled || !started) return;
				ensure().notifyLocalChange();
			};

			document.addEventListener("visibilitychange", onVisibility);
			window.addEventListener("focus", onFocus);
			window.addEventListener("online", onOnline);
			const unsubscribeMutations = mutations.subscribe(onMutation);
			detach = () => {
				document.removeEventListener("visibilitychange", onVisibility);
				window.removeEventListener("focus", onFocus);
				window.removeEventListener("online", onOnline);
				unsubscribeMutations();
			};

			/**
			 * Keeps the start procedure from leaking a rejection. The first line inside is a local database
			 * read. Logout and account deletion close the connection while that read is pending
			 * (DatabaseClosedError). Uncaught, normal cleanup would show up as an unhandled rejection in the
			 * console. On failure the only action is not to start. The next scope retries with a new
			 * runtime.
			 */
			void (async () => {
				const stale = (): boolean =>
					claimed !== generation || !started || !ownsStore();
				enabled = await preference.isEnabled();
				if (stale()) return;
				/*
				 * Publish the toggle state first. inspect() below is a network round trip. Publishing after it
				 * would show a user who turned auto-sync off a switch reading 'on' for one round trip on the
				 * account screen.
				 */
				republish();
				/**
				 * Checks the server keyring. On a remembered device, the lock is released here. This does NOT
				 * create a setting. Without a keyring it ends in disabled and auto-sync goes quiet. An
				 * untrusted, locked device is the same: it never asks for the recovery code in the background.
				 */
				await controller.inspect();
				if (stale()) return;
				republish();
				requestAuto("startup");
			})().catch(() => undefined);
		},

		stop() {
			if (!started) return;
			started = false;
			generation++;
			detach?.();
			detach = null;
			disposeCoordinator();
			republish();
		},

		runManualSync() {
			return ensure().runNow();
		},

		requestSync(reason) {
			requestAuto(reason);
		},

		async setEnabled(next) {
			enabled = next;
			await preference.setEnabled(next);
			if (next) {
				/**
				 * Runs once immediately on enable, so dirty records that accumulated while off ride on this
				 * run. Without it, the user turns the toggle on and sees nothing happen.
				 */
				republish();
				requestAuto("enabled");
				return;
			}
			/**
			 * Turning it off also discards timers already set (debounce, backoff). Dropping the instance
			 * removes all of them at once. Rule: a stopped coordinator is never reused. Turning it on again
			 * or pressing the manual button creates a new instance.
			 *
			 * It does not lock, erase the key, or clear dirty. What turns off is the schedule, not sync
			 * itself.
			 */
			disposeCoordinator();
			republish();
		},

		snapshot: () => snapshot,

		subscribe(listener) {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
	};
}

/**
 * Narrows sync runs to one tab using the Web Locks API. This prevents wasted work, not corruption.
 * Two tabs can run at once without breaking data: if one wins the push, the other gets a conflict,
 * pulls, merges, and retries. applyPull is idempotent, and the cursor uses the same transaction
 * axis. The cost is duplicate work: the same records are encrypted and uploaded twice, and with
 * auto-sync that round trip grows with the number of tabs.
 *
 * There is no leader election. The browser releases the lock automatically when a tab dies. A
 * hand-built version would need death detection, handover, and re-election, all to solve duplicate
 * requests. Where Web Locks is unsupported, tabs simply run concurrently: still correct, only
 * wasteful.
 */
export async function withSyncLock<T>(
	viewerId: string,
	run: () => Promise<T>,
): Promise<T | null> {
	const locks = (
		navigator as Navigator & {
			locks?: {
				request<R>(
					name: string,
					options: { ifAvailable: boolean },
					callback: (lock: unknown) => Promise<R>,
				): Promise<R>;
			};
		}
	).locks;
	if (!locks) return run();
	// The lock name includes the member id, so switching accounts naturally produces a different lock.
	return locks.request(
		`rowcat.sync.${viewerId}`,
		{ ifAvailable: true },
		(lock) => (lock ? run() : Promise.resolve(null)),
	);
}
