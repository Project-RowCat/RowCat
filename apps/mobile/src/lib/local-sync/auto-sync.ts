import type {
	AutoSyncOutcome,
	AutoSyncStatus,
	SyncController,
	SyncReason,
} from "@rowcat/sync";
import { createAutoSyncCoordinator, SYNC_LOGIN_REQUIRED } from "@rowcat/sync";
import type { AutoSyncPreferenceStore } from "../local-data/auto-sync-preference.ts";
import type { LocalMutationSignal } from "../local-data/mutation-signal.ts";

/**
 * Mobile adapter for auto-sync. It holds no schedule, only signals.
 *
 * The boundary is the whole point of this file:
 *
 * ```text
 * @rowcat/sync   when it runs: debounce, single run, one follow-up, backoff
 * here          what wakes it: app lifecycle, network return, local writes
 * ```
 *
 * It occupies the same place as the web's `local-sync/auto-sync.ts`. The only difference is where
 * the signals come from (web: `visibilitychange`, `focus`, `online`; here: `AppState` and
 * `expo-network`). The sources arrive through ports for verification: `AppState` depends on a
 * native module and does not open in Node, and a mock would let tests pass without anyone checking
 * that one foreground return means one request. The wiring lives in `expo-signals.ts`.
 *
 * Deliberately absent:
 * - A periodic timer. There is no `setInterval` at all: a quiet app makes no requests.
 * - Web Locks. Browsers have several tabs hitting one database, but this app runs one process,
 *   and the coordinator's single run already prevents duplicate runs.
 * - Background fetch, push, or SSE. Remote wake-up is an extension intentionally deferred
 *   (`provider.tsx`).
 * - Toasts. An automatic failure is not something the user did, so nothing is shown. The account
 *   → data status line says what is happening.
 */

/**
 * The source of app lifecycle events. It knows only the **shape** of React Native's `AppState`.
 *
 * `current()` exists for startup: listeners receive transitions only, so without knowing whether
 * the app is active right now, the adapter could not judge the direction of the first transition.
 */
export interface MobileLifecycleSource {
	current(): string;
	subscribe(listener: (state: string) => void): () => void;
}

/**
 * The source of connection state. **It is a hint, not reachability.**
 *
 * `null` means "unknown" and is treated as online (blocking gains nothing). The value does two
 * things: when offline, it stops retry timers from continuing, and when the connection returns, it
 * wakes sync once.
 */
export interface MobileNetworkSource {
	current(): boolean | null;
	subscribe(listener: (online: boolean) => void): () => void;
}

/** One line the screen sees: the coordinator's status plus this device's toggle (same shape as the web). */
export interface AutoSyncSnapshot extends AutoSyncStatus {
	enabled: boolean;
}

export interface MobileAutoSyncOptions {
	controller: SyncController;
	mutations: LocalMutationSignal;
	preference: AutoSyncPreferenceStore;
	/**
	 * Whether this store **still** belongs to the active scope.
	 *
	 * It is asked again right before every run because of account switching. A timer left over from
	 * `Alice → sign out → Bob` that wakes up would run on Bob's scope, while the cursor and keys
	 * carried inside belong to Alice. Comparing member ids is not enough: `Alice → sign out → Alice`
	 * gives the same id with a freshly opened connection.
	 */
	ownsStore: () => boolean;
	lifecycle: MobileLifecycleSource;
	network: MobileNetworkSource;
	/** Timing constants. Omitted means shared defaults. Overridden in tests (same as the web). */
	timing?: { localDebounceMs?: number; lifecycleWindowMs?: number };
}

export interface MobileAutoSync {
	/** Attaches the signals and runs the startup sequence. **Idempotent** (for StrictMode's double mount). */
	start(): void;
	/** Detaches the signals and permanently stops the coordinator. A stopped instance is never reused. */
	stop(): void;
	/** Manual button. Runs even when auto-sync is off. Passes through the **same gate** as automatic runs. */
	runManualSync(): Promise<AutoSyncOutcome>;
	/** Called at the moment sync becomes runnable, such as after unlock or pairing completes. */
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

export function createMobileAutoSync(
	options: MobileAutoSyncOptions,
): MobileAutoSync {
	const {
		controller,
		mutations,
		preference,
		ownsStore,
		lifecycle,
		network,
		timing,
	} = options;

	let coordinator: ReturnType<typeof createAutoSyncCoordinator> | null = null;
	let unsubscribeCoordinator: (() => void) | null = null;
	let detach: (() => void) | null = null;
	let started = false;
	/** Generation of the startup sequence, so a first sequence cannot pass itself off as the second after `start → stop → start`. */
	let generation = 0;
	let enabled = true;
	/** Last connection state heard. `null` means unknown and is treated as online. */
	let lastOnline: boolean | null = network.current();
	/** The value `useSyncExternalStore` reads. It must be the same reference when nothing changed. */
	let snapshot: AutoSyncSnapshot = { ...IDLE, enabled };
	const listeners = new Set<() => void>();

	const publish = (next: AutoSyncSnapshot): void => {
		snapshot = next;
		for (const listener of listeners) listener();
	};

	const republish = (): void =>
		publish({ ...(coordinator?.status() ?? IDLE), enabled });

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
				 * Three conditions allow a run: this scope is still mine, this device holds the key, and the
				 * controller is in a runnable state. **The automatic toggle is not here.** Turning it off turns
				 * off the automatic trigger, not the user's button.
				 */
				canRun: () => {
					if (!ownsStore()) return false;
					const state = controller.snapshot();
					return (
						state.trusted &&
						(state.state === "ready" || state.state === "error")
					);
				},
				isOnline: () => lastOnline !== false,
				run: async () => {
					const result = await controller.syncNow();
					// null means "did not run because there is no key", not a failure.
					return result !== null;
				},
			},
		});
		coordinator = created;
		unsubscribeCoordinator = created.subscribe(republish);
		return created;
	}

	/** Automatic triggers pass through the toggle. The manual path (`runManualSync`) does not. */
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
			 * One foreground return is one request. iOS routinely passes through `active → inactive →
			 * active`, so **only transitions from a non-active state into active** are counted. Counting
			 * `inactive` and `background` separately would wake sync twice for the same return.
			 */
			let lastState = lifecycle.current();
			const unsubscribeLifecycle = lifecycle.subscribe((next) => {
				const was = lastState;
				lastState = next;
				if (next === "active" && was !== "active") requestAuto("visible");
			});

			/**
			 * Only the offline → online transition wakes sync. `online → online` (a change of connection
			 * type) finds nothing to do, since sync was already runnable. Turning every transition into a
			 * request would make each cellular handoff during movement a round trip.
			 */
			const unsubscribeNetwork = network.subscribe((online) => {
				const was = lastOnline;
				lastOnline = online;
				if (online && was === false) requestAuto("online");
			});

			const unsubscribeMutations = mutations.subscribe(() => {
				if (!enabled || !started) return;
				ensure().notifyLocalChange();
			});

			detach = () => {
				unsubscribeLifecycle();
				unsubscribeNetwork();
				unsubscribeMutations();
			};

			/**
			 * Startup sequence. It does not leak rejections. Its first line reads the local database, so
			 * logout or deletion may close the connection in the meantime, which is normal cleanup. On
			 * failure it simply does not start; the next scope retries with a new runtime.
			 */
			void (async () => {
				const stale = (): boolean =>
					claimed !== generation || !started || !ownsStore();
				enabled = await preference.isEnabled();
				if (stale()) return;
				/** Announce the toggle first: `inspect()` is a network round trip (same order as the web). */
				republish();
				/**
				 * Checks the server keyring, and if this device is remembered, unlocks here. **It does not
				 * create settings**, and on a locked device it does not ask for the recovery code. It only
				 * settles the state.
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
				/** Runs once at the moment of turning on, so changes that piled up while off are carried by that run. */
				republish();
				requestAuto("enabled");
				return;
			}
			/**
			 * Turning off also removes any pending timers (debounce, backoff). It does not lock, does not
			 * erase keys, and does not clear `dirty`. Turning off is the **schedule**, not sync itself.
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
