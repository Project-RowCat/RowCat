import {
	emptyPersistentStateSnapshot,
	type RuntimePersistentStateSnapshot,
	validatePersistentStateSnapshot,
} from "@rowcat/runtime-host/persistent-state";
import {
	emptyStoryStateSnapshot,
	type RuntimeStoryStateSnapshot,
	validateStoryStateSnapshot,
} from "@rowcat/runtime-host/story-state";
import {
	RuntimeSaveCoordinator,
	type RuntimeSaveCoordinatorOptions,
	type RuntimeSaveState,
} from "./coordinator.ts";
import { DEFAULT_RUNTIME_SAVE_SLOT, type RuntimeSaveSlot } from "./model.ts";
import type { RuntimeSaveStore } from "./store.ts";

/**
 * Save adapter used by the play surface, scoped to one session's lifetime.
 * - Sits between the member-scoped RuntimeSaveStore and the runtime host session. It knows
 *   nothing of React or screens.
 * - Commit callbacks flow through the commit coordinator to the local DB, then on to sync.
 * - The Phase 7 web and native play screens use this object directly. The studio preview must not
 *   write through it, because a creator's test must not alter a player's progress (§71).
 */

/**
 * Result of reading a save. It separates three states that all look like 'no save'.
 * - ready: a valid local save exists. It may be empty, which is a new game.
 * - sync-required: nothing is stored locally and the first sync has not finished. This is not a
 *   new game.
 * - failed: storage is dead or the stored value is corrupt. Do not overwrite it. The middle state
 *   exists because folding it into ready on a freshly paired device starts a new game on an account
 *   with months of progress. The first commit would then overwrite the real save.
 */
export type RuntimeSaveResolution =
	| {
			status: "ready";
			storyState: RuntimeStoryStateSnapshot;
			persistentState: RuntimePersistentStateSnapshot;
	  }
	| { status: "sync-required" }
	| { status: "failed"; error: RuntimePersistenceError };

/** Error from the persistence layer. It is not an error from the creator's runtime. */
export class RuntimePersistenceError extends Error {
	readonly code: RuntimePersistenceErrorCode;
	constructor(code: RuntimePersistenceErrorCode, message: string) {
		super(message);
		this.name = "RuntimePersistenceError";
		this.code = code;
	}
}

export const RUNTIME_PERSISTENCE_ERROR_CODE = {
	unavailable: "runtime_persistence_unavailable",
	/**
	 * The stored snapshot does not match the expected shape. Leave it in place and do not overwrite
	 * it.
	 */
	corrupt: "runtime_persistence_corrupt",
	/**
	 * The snapshot exceeds the product limit, so it would not fit in a sync record. This failure
	 * happens before the durable write. If the write went first, the push would fail later, with an
	 * unsyncable value already sitting in local storage, and the user would only see that sync stopped
	 * days ago.
	 */
	tooLarge: "runtime_persistence_too_large",
} as const;

export type RuntimePersistenceErrorCode =
	(typeof RUNTIME_PERSISTENCE_ERROR_CODE)[keyof typeof RUNTIME_PERSISTENCE_ERROR_CODE];

export interface RuntimePlayerPersistenceOptions {
	store: RuntimeSaveStore;
	storyId: string;
	slot?: RuntimeSaveSlot;
	clock?: RuntimeSaveCoordinatorOptions["clock"];
	onWritten?: () => void;
	onStateChange?: (state: RuntimeSaveState) => void;
}

export interface RuntimePlayerPersistence {
	load(): Promise<RuntimeSaveResolution>;
	/**
	 * Called once, after a session has started successfully, with the canonical snapshots that
	 * hydration produced. This single write is what makes a migration durable. Without it, every
	 * session re-runs the same migration. That is harmless for a deterministic migration, but a
	 * non-deterministic one (random values, timestamps) would change progress on every run. If the
	 * values are unchanged, nothing is written. Writing anyway would bump the revision on every open
	 * and mark the record dirty, so unchanged data would be pushed every session. Do not call this if
	 * the session failed to start (§52). A failed migration must not change a single stored value.
	 */
	sessionHydrated(snapshots: {
		storyState: RuntimeStoryStateSnapshot;
		persistentState: RuntimePersistentStateSnapshot;
	}): void;
	storyStateCommitted(snapshot: RuntimeStoryStateSnapshot): void;
	persistentStateCommitted(snapshot: RuntimePersistentStateSnapshot): void;
	/** Writes an empty playthrough snapshot. Persistent state is not touched. */
	resetPlaythrough(): Promise<void>;
	state(): RuntimeSaveState;
	retry(): void;
	flush(timeoutMs?: number): Promise<void>;
	dispose(timeoutMs?: number): Promise<void>;
}

export function createRuntimePlayerPersistence(
	options: RuntimePlayerPersistenceOptions,
): RuntimePlayerPersistence {
	const slot = options.slot ?? DEFAULT_RUNTIME_SAVE_SLOT;
	const coordinator = new RuntimeSaveCoordinator({
		store: options.store,
		storyId: options.storyId,
		slot,
		...(options.clock === undefined ? {} : { clock: options.clock }),
		...(options.onWritten === undefined
			? {}
			: { onWritten: options.onWritten }),
		...(options.onStateChange === undefined
			? {}
			: { onStateChange: options.onStateChange }),
	});

	/**
	 * Holds the values load() returned. sessionHydrated compares against these. The store is not
	 * re-read, because a sync may have applied remote values in between. The baseline must be the
	 * values this session actually received, so that it answers whether the migration changed
	 * anything.
	 */
	let loadedStory: string | null = null;
	let loadedPersistent: string | null = null;

	return {
		/**
		 * Local-first: if a valid local save exists, do not wait for the network. Ask whether the first
		 * sync has finished only when nothing is stored locally. Reversing that order would make every
		 * offline normal launch return sync-required, and no one could start a game.
		 */
		async load(): Promise<RuntimeSaveResolution> {
			let storyRecord: Awaited<ReturnType<RuntimeSaveStore["getPlaythrough"]>>;
			let persistentRecord: Awaited<
				ReturnType<RuntimeSaveStore["getPersistent"]>
			>;
			try {
				storyRecord = await options.store.getPlaythrough(options.storyId, slot);
				persistentRecord = await options.store.getPersistent(options.storyId);
			} catch (error) {
				return {
					status: "failed",
					error: new RuntimePersistenceError(
						RUNTIME_PERSISTENCE_ERROR_CODE.unavailable,
						`Could not read the save: ${String(error)}`,
					),
				};
			}

			if (storyRecord === null && persistentRecord === null) {
				let done: boolean;
				try {
					done = await options.store.initialSyncDone();
				} catch (error) {
					return {
						status: "failed",
						error: new RuntimePersistenceError(
							RUNTIME_PERSISTENCE_ERROR_CODE.unavailable,
							`Could not read the sync state: ${String(error)}`,
						),
					};
				}
				if (!done) return { status: "sync-required" };
			}

			/**
			 * Stored snapshots are re-validated. Local rows can be edited by hand, may hold values written
			 * by an old bug, or may have been restored corrupted. If a row fails the shape check, it is not
			 * overwritten. A failure is returned instead. Validation must never be the reason progress
			 * disappears.
			 */
			const story =
				storyRecord === null || storyRecord.deletedAt !== null
					? { ok: true as const, snapshot: emptyStoryStateSnapshot() }
					: validateStoryStateSnapshot(storyRecord.snapshot);
			if (!story.ok)
				return {
					status: "failed",
					error: new RuntimePersistenceError(
						RUNTIME_PERSISTENCE_ERROR_CODE.corrupt,
						`Could not read the saved playthrough state: ${story.reason}`,
					),
				};
			const persistent =
				persistentRecord === null || persistentRecord.deletedAt !== null
					? { ok: true as const, snapshot: emptyPersistentStateSnapshot() }
					: validatePersistentStateSnapshot(persistentRecord.snapshot);
			if (!persistent.ok)
				return {
					status: "failed",
					error: new RuntimePersistenceError(
						RUNTIME_PERSISTENCE_ERROR_CODE.corrupt,
						`Could not read the saved persistent state: ${persistent.reason}`,
					),
				};
			loadedStory = JSON.stringify(story.snapshot);
			loadedPersistent = JSON.stringify(persistent.snapshot);
			return {
				status: "ready",
				storyState: story.snapshot,
				persistentState: persistent.snapshot,
			};
		},

		sessionHydrated({ storyState, persistentState }): void {
			if (JSON.stringify(storyState) !== loadedStory) {
				loadedStory = JSON.stringify(storyState);
				coordinator.storyStateCommitted(storyState);
			}
			if (JSON.stringify(persistentState) !== loadedPersistent) {
				loadedPersistent = JSON.stringify(persistentState);
				coordinator.persistentStateCommitted(persistentState);
			}
		},

		storyStateCommitted: (snapshot) =>
			coordinator.storyStateCommitted(snapshot),
		persistentStateCommitted: (snapshot) =>
			coordinator.persistentStateCommitted(snapshot),

		/**
		 * Reset does not delete the row. It writes an empty snapshot at a higher revision (§48). A local
		 * delete would not propagate, and a device still holding old progress would restore it on sync.
		 * The call goes straight to the store, not through the coordinator. Through the coordinator, the
		 * reset could merge with another commit, so the next frame's commit could rewrite the old value.
		 */
		async resetPlaythrough(): Promise<void> {
			await coordinator.flush();
			await options.store.putPlaythrough({
				storyId: options.storyId,
				slot,
				snapshot: emptyStoryStateSnapshot(),
				updatedAt: (
					options.clock ?? { now: () => new Date().toISOString() }
				).now(),
			});
			options.onWritten?.();
		},

		state: () => coordinator.state(),
		retry: () => coordinator.retry(),
		flush: (timeoutMs) => coordinator.flush(timeoutMs),
		dispose: (timeoutMs) => coordinator.dispose(timeoutMs),
	};
}
