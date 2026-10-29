import type { RuntimePersistentStateSnapshot } from "@rowcat/runtime-host/persistent-state";
import type { RuntimeStoryStateSnapshot } from "@rowcat/runtime-host/story-state";
import { DEFAULT_RUNTIME_SAVE_SLOT, type RuntimeSaveSlot } from "./model.ts";
import type {
	RuntimePersistenceError,
	RuntimePlayerPersistence,
} from "./player.ts";
import type { RuntimeSaveStore } from "./store.ts";

/**
 * Playthrough lifecycle: one owner per save scope at all times.
 *
 * Requests (start, restart, reset, teardown) queue on one lane. The old owner: abort the
 * generation, stop the VM (cleanup), fully flush the save, dispose the coordinator, release the
 * host. Only then does the new owner start: write the empty playthrough if reset, load(), start the
 * VM. Nothing reads or clears the next scope before the old owner's steps finish.
 *
 * Why a layer is needed: the coordinator is ordered internally, but two coordinators race. If
 * session A commits chapter 2 and its write has not reached disk when restart starts session B, B's
 * load() reads chapter 1 and A's write lands later. The screen showed chapter 2; the new VM starts
 * at chapter 1. On reset, whichever of the empty write and the old session's last write finishes
 * later wins.
 *
 * React's effect cleanup does not wait (an async cleanup changes nothing), so serialization lives
 * in this object, outside React. Web workers and native WebViews are unaware of it; they sit behind
 * the owner handle that startSession returns.
 *
 * Two flush kinds: leaving a screen or app uses dispose(teardownFlushTimeoutMs), a capped
 * best-effort flush that never blocks navigation. Explicit restart or reset flushes to the end with
 * no timeout, because order is correctness.
 *
 * If the flush does not finish (storage failure), the next session is not started. Starting from
 * the old value would silently drop the progress on screen, and the old pending write would later
 * revert the reset. The transition stays blocked until the existing save-retry action resumes it.
 *
 * Requests coalesce without creating intermediate sessions. reset is OR-ed, so a requested reset
 * always happens. Whether start is set is decided by the last request, so restart, restart, reset,
 * restart leaves one session started from the initial state. At most one owner is ever alive.
 *
 * Instances on the same scope queue together too. Per-instance lanes alone let the old instance's
 * flush overlap the new instance's load(), so there is one lane per scope (storage, work, slot). It
 * is keyed by a WeakMap on the storage object, which is a per-member singleton.
 */

export interface RuntimePlayerSessionOwner {
	/**
	 * Stops the running generation and the VM, and waits until cleanup finishes. No save commit may
	 * arrive after this promise resolves. That is why the flush that follows is the last one, and it
	 * is the basis for the claim that the saved value holds the whole state. If the host never
	 * answers, the wait is capped and the function ends. That cap belongs to the VM, not to storage.
	 */
	stop(): Promise<void>;
	/**
	 * Releases the execution host. This happens after storage has been disposed (worker terminated,
	 * bridge closed).
	 */
	release(): void;
}

export interface RuntimePlayerScope {
	store: RuntimeSaveStore;
	storyId: string;
	slot?: RuntimeSaveSlot;
}

export interface RuntimePlayerSessionStart {
	/**
	 * The sequence number of this transition, increasing monotonically within the instance. The web
	 * uses it as the generation.
	 */
	token: number;
	/** Whether this session started after a reset. */
	reset: boolean;
	storyState: RuntimeStoryStateSnapshot;
	persistentState: RuntimePersistentStateSnapshot;
	/** This session's storage. Commits go here. */
	persistence: RuntimePlayerPersistence;
}

export type RuntimePlayerLifecycleEvent =
	/**
	 * The transition has started, before the old owner is stopped. The screen becomes `starting` here.
	 */
	| { type: "transition"; token: number; reset: boolean }
	| { type: "sync-required"; token: number }
	| { type: "load-failed"; token: number; error: RuntimePersistenceError }
	/**
	 * The transition cannot safely finish: either the old save could not be flushed to the end
	 * (flush), or the empty playthrough could not be written (reset). No session was started, and the
	 * save retry resumes this transition.
	 */
	| {
			type: "blocked";
			token: number;
			stage: "flush" | "reset";
			message: string;
	  }
	/** startSession threw: the execution host could not be started. */
	| { type: "start-failed"; token: number; message: string }
	| { type: "started"; token: number }
	/** No owner. Leaving has finished. */
	| { type: "idle" };

export interface RuntimePlayerLifecycleOptions {
	/**
	 * The current scope. It is read when a transition runs, so one instance serves even when the
	 * account or work changes.
	 */
	scope(): RuntimePlayerScope;
	createPersistence(scope: RuntimePlayerScope): RuntimePlayerPersistence;
	startSession(
		start: RuntimePlayerSessionStart,
	): Promise<RuntimePlayerSessionOwner> | RuntimePlayerSessionOwner;
	onEvent?(event: RuntimePlayerLifecycleEvent): void;
	/** Flush cap when leaving. Does not apply to explicit transitions. */
	teardownFlushTimeoutMs?: number;
}

export interface RuntimePlayerLifecycle {
	/** The first session, or a session after the scope or conditions change. */
	start(): void;
	/** Rebuilds only the VM, on the same save. */
	restart(): void;
	/** Ends the old owner, empties the playthrough, then builds a new one. */
	resetPlaythrough(): void;
	/** Leaves: ends the owner and builds nothing. */
	teardown(): void;
	/** Retries saving. If a transition is blocked, it resumes that transition. */
	retrySave(): void;
	/** The current owner's storage. null if there is none. */
	persistence(): RuntimePlayerPersistence | null;
	isBlocked(): boolean;
	/** Waits until all queued transitions finish. Tests wait here. */
	settled(): Promise<void>;
}

interface Intent {
	start: boolean;
	reset: boolean;
}

interface Owner {
	token: number;
	scope: RuntimePlayerScope;
	persistence: RuntimePlayerPersistence;
	session: RuntimePlayerSessionOwner | null;
	stopped: boolean;
}

const scopeLanes = new WeakMap<RuntimeSaveStore, Map<string, Promise<void>>>();

const scopeKey = (scope: RuntimePlayerScope): string =>
	`${scope.storyId}:${scope.slot ?? DEFAULT_RUNTIME_SAVE_SLOT}`;

/**
 * Holds the lane for one scope and runs work on it, after the previous instance's transition has
 * finished.
 */
function withScopeLane<T>(
	scope: RuntimePlayerScope,
	work: () => Promise<T>,
): Promise<T> {
	let lanes = scopeLanes.get(scope.store);
	if (lanes === undefined) {
		lanes = new Map();
		scopeLanes.set(scope.store, lanes);
	}
	const key = scopeKey(scope);
	const previous = lanes.get(key) ?? Promise.resolve();
	const result = previous.then(work, work);
	const next = result.then(
		() => undefined,
		() => undefined,
	);
	lanes.set(key, next);
	void next.then(() => {
		if (lanes?.get(key) === next) lanes.delete(key);
	});
	return result;
}

const describe = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

const stillPending = (persistence: RuntimePlayerPersistence): boolean => {
	const state = persistence.state();
	return state.playthrough.pending || state.persistent.pending;
};

export function createRuntimePlayerLifecycle(
	options: RuntimePlayerLifecycleOptions,
): RuntimePlayerLifecycle {
	let lane: Promise<void> = Promise.resolve();
	let pending: Intent | null = null;
	/** A transition halted because its flush did not finish. Retry requests it again. */
	let blocked: Intent | null = null;
	let current: Owner | null = null;
	let nextToken = 0;

	const emit = (event: RuntimePlayerLifecycleEvent): void => {
		options.onEvent?.(event);
	};

	/**
	 * Retires the old owner. In strict mode it flushes the save to the end. If it cannot, it leaves
	 * the owner in place and returns false. The save was not discarded, so a retry can continue from
	 * there.
	 */
	async function retire(owner: Owner, strict: boolean): Promise<boolean> {
		if (!owner.stopped) {
			owner.stopped = true;
			try {
				if (owner.session !== null) await owner.session.stop();
			} catch {
				/**
				 * Failing to stop the VM is not a storage failure. Even if the host never answers, commits that
				 * already arrived are in the coordinator, and flushing them is what remains of this function.
				 */
			}
		}
		if (strict) {
			await owner.persistence.flush();
			if (stillPending(owner.persistence)) return false;
			await owner.persistence.dispose();
		} else {
			await owner.persistence.dispose(options.teardownFlushTimeoutMs);
		}
		owner.session?.release();
		if (current === owner) current = null;
		return true;
	}

	async function run(): Promise<void> {
		const intent = pending;
		pending = null;
		/** An earlier run already handled this request too, so there is nothing to do. */
		if (intent === null) return;
		blocked = null;

		const token = intent.start ? ++nextToken : nextToken;
		if (intent.start) emit({ type: "transition", token, reset: intent.reset });

		const previous = current;
		if (previous !== null) {
			const strict = intent.start || intent.reset;
			const retired = await withScopeLane(previous.scope, () =>
				retire(previous, strict),
			);
			if (!retired) {
				blocked = intent;
				emit({
					type: "blocked",
					token,
					stage: "flush",
					message:
						previous.persistence.state().playthrough.error ??
						previous.persistence.state().persistent.error ??
						"runtime_persistence_flush_incomplete",
				});
				return;
			}
		}

		if (!intent.start && !intent.reset) {
			emit({ type: "idle" });
			return;
		}

		let scope: RuntimePlayerScope;
		try {
			scope = options.scope();
		} catch (error) {
			/**
			 * The scope has closed (logout), so there is no place to build a session. Report an error
			 * instead of ending silently.
			 */
			emit({ type: "start-failed", token, message: describe(error) });
			return;
		}
		await withScopeLane(scope, async () => {
			let persistence: RuntimePlayerPersistence;
			try {
				persistence = options.createPersistence(scope);
			} catch (error) {
				emit({ type: "start-failed", token, message: describe(error) });
				return;
			}
			if (intent.reset) {
				try {
					await persistence.resetPlaythrough();
				} catch (error) {
					/**
					 * The reset was not written. Building with the old state would not be the transition the user
					 * asked for.
					 */
					await persistence.dispose();
					blocked = intent;
					emit({
						type: "blocked",
						token,
						stage: "reset",
						message: describe(error),
					});
					return;
				}
			}
			if (!intent.start) {
				await persistence.dispose();
				emit({ type: "idle" });
				return;
			}
			/** A new request arrived meanwhile. This session is about to be left, so it is not started. */
			if (pending !== null) {
				await persistence.dispose();
				return;
			}

			const resolution = await persistence.load();
			if (pending !== null) {
				await persistence.dispose();
				return;
			}
			if (resolution.status === "sync-required") {
				await persistence.dispose();
				emit({ type: "sync-required", token });
				return;
			}
			if (resolution.status === "failed") {
				await persistence.dispose();
				emit({ type: "load-failed", token, error: resolution.error });
				return;
			}

			const owner: Owner = {
				token,
				scope,
				persistence,
				session: null,
				stopped: false,
			};
			current = owner;
			try {
				owner.session = await options.startSession({
					token,
					reset: intent.reset,
					storyState: resolution.storyState,
					persistentState: resolution.persistentState,
					persistence,
				});
			} catch (error) {
				current = null;
				await persistence.dispose();
				emit({ type: "start-failed", token, message: describe(error) });
				return;
			}
			emit({ type: "started", token });
		});
	}

	/**
	 * Merges requests: reset is OR-ed, and start takes the last request's value. A blocked
	 * transition's reset is also inherited. If a reset was blocked and the user then pressed restart,
	 * that restart must not discard the reset. Otherwise the user would see a session start from old
	 * progress they never asked to keep.
	 */
	const request = (intent: Intent): void => {
		const inherited = pending ?? blocked;
		pending =
			inherited === null
				? intent
				: { start: intent.start, reset: inherited.reset || intent.reset };
		lane = lane.then(run, run);
	};

	return {
		start: () => request({ start: true, reset: false }),
		restart: () => request({ start: true, reset: false }),
		resetPlaythrough: () => request({ start: true, reset: true }),
		teardown: () => request({ start: false, reset: false }),
		retrySave() {
			if (blocked !== null) {
				request(blocked);
				return;
			}
			current?.persistence.retry();
		},
		persistence: () => current?.persistence ?? null,
		isBlocked: () => blocked !== null,
		settled: () => lane,
	};
}
