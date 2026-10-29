import type { RuntimePersistentStateSnapshot } from "@rowcat/runtime-host/persistent-state";
import type { RuntimeStoryStateSnapshot } from "@rowcat/runtime-host/story-state";
import {
	DEFAULT_RUNTIME_SAVE_SLOT,
	RUNTIME_SAVE_LIMITS,
	type RuntimeSaveSlot,
} from "./model.ts";
import type { RuntimeSaveStore } from "./store.ts";

/**
 * Save coordinator: between the VM's commits and the local database.
 * - A runtime commit is synchronous and never throws. It offers the latest desired snapshot,
 *   which is one slot, not a queue.
 * - Serialized writes go to the local DB (HLC, dirty), then wake the existing sync.
 *
 * The runtime's atomicity (UI and state advance together) and the database's durability (eventually
 * on disk) are different boundaries. Awaiting IndexedDB on the commit path would tie each frame to
 * storage latency, and a failed save would require undoing a render already on screen, which is
 * impossible. So here a failure is a state (failed), not a runtime failure.
 *
 * It is not a queue. Commits outpace storage, an unbounded queue grows without limit, and no one
 * needs intermediate snapshots: the last full snapshot contains all before it. If 11 and 12 arrive
 * while 10 is being written, only 12 is written.
 *
 * It never goes backwards. Overlapping writes could let a late old snapshot overwrite a newer one.
 * Each scope has one write at a time, and the next starts after the previous finishes. That
 * serialization is the ordering guarantee.
 *
 * The generation is the gate. A commit reaching a disposed coordinator writes nothing. After an
 * account change, a late snapshot from the previous member would otherwise land in the new scope.
 */

export type RuntimeSaveStatus = "idle" | "saving" | "saved" | "failed";

export interface RuntimeSaveScopeState {
	status: RuntimeSaveStatus;
	/**
	 * Last failure. The next success clears it. It is the value the screen draws, not the basis for
	 * correctness.
	 */
	error: string | null;
	pending: boolean;
}

export interface RuntimeSaveState {
	playthrough: RuntimeSaveScopeState;
	persistent: RuntimeSaveScopeState;
}

/**
 * Whether progress is not yet durable: true if either lifetime failed to write. Both apps call this
 * same function because its result is the condition for the on-screen warning. Writing each app's
 * own status check lets one side forget a lifetime, and the symptom is a warning that never
 * appears. The function does not say which lifetime failed. The user's action is the same either
 * way (save again), and which lifetime failed is storage vocabulary, not product vocabulary.
 */
export const runtimeSaveDurabilityAtRisk = (
	state: RuntimeSaveState | null | undefined,
): boolean =>
	state !== null &&
	state !== undefined &&
	(state.playthrough.status === "failed" ||
		state.persistent.status === "failed");

export interface RuntimeSaveMetrics {
	writes: number;
	coalesced: number;
	failures: number;
}

/**
 * The clock is injected: the storage layer keeps no clock of its own, so tests are deterministic.
 * 'delay' is optional because this package has no timer globals (lib is ES2022 only). Without it,
 * flush waits indefinitely. That is correct behavior, not a defect.
 */
export interface RuntimeSaveClock {
	now(): string;
	delay?(ms: number): Promise<void>;
}

export interface RuntimeSaveCoordinatorOptions {
	store: RuntimeSaveStore;
	storyId: string;
	slot?: RuntimeSaveSlot;
	clock?: RuntimeSaveClock;
	/**
	 * Called once when a local record actually changed. This is where the existing sync runtime is
	 * woken. Do not call fetch from this callback. Once the coordinator knows the server, this layer
	 * becomes a second sync path, and single-flight, backoff and account isolation do not apply to it
	 * (§59).
	 */
	onWritten?: () => void;
	onStateChange?: (state: RuntimeSaveState) => void;
}

const idleScope = (): RuntimeSaveScopeState => ({
	status: "idle",
	error: null,
	pending: false,
});

/**
 * A product limit, checked before the durable write. Throwing here makes the failure a coordinator
 * state (failed), and the runtime keeps running (§34). Checking after the write would fail later,
 * at push: an unuploadable value would sit in local storage, and the user would see only 'sync
 * stopped days ago'.
 */
function assertWritable(snapshot: unknown): void {
	const length = JSON.stringify(snapshot).length;
	if (length > RUNTIME_SAVE_LIMITS.maxSnapshotSerializedLength)
		throw new Error(
			`runtime_persistence_too_large: the save snapshot is ${length} characters, over the limit (${RUNTIME_SAVE_LIMITS.maxSnapshotSerializedLength} characters).`,
		);
}

const describe = (error: unknown): string =>
	error instanceof Error ? `${error.name}: ${error.message}` : String(error);

/**
 * The write pipeline for one scope. This class is all of §33-36. It is generic because both
 * lifetimes must follow the same rules. A copy would let coalescing, ordering or retry get fixed on
 * one side only, and the mismatch would show up as 'saving stalls for this lifetime alone'.
 */
class SaveLane<S> {
	private desired: S | null = null;
	private writing = false;
	private inFlight: Promise<void> | null = null;
	private state = idleScope();
	readonly metrics: RuntimeSaveMetrics = {
		writes: 0,
		coalesced: 0,
		failures: 0,
	};

	constructor(
		private readonly write: (snapshot: S) => Promise<void>,
		private readonly changed: () => void,
	) {}

	snapshotState(): RuntimeSaveScopeState {
		return { ...this.state };
	}

	/** One commit. Synchronous; never throws. */
	offer(snapshot: S): void {
		if (this.desired !== null) this.metrics.coalesced += 1;
		this.desired = snapshot;
		this.state = { ...this.state, pending: true };
		this.changed();
		this.pump();
	}

	private pump(): void {
		if (this.writing || this.desired === null) return;
		this.writing = true;
		this.inFlight = this.drain().finally(() => {
			this.writing = false;
			this.inFlight = null;
		});
	}

	private async drain(): Promise<void> {
		while (this.desired !== null) {
			const snapshot = this.desired;
			this.desired = null;
			this.state = { status: "saving", error: null, pending: false };
			this.changed();
			try {
				await this.write(snapshot);
				this.metrics.writes += 1;
				/**
				 * If a new value arrived during the write, pending is what that value says, so it is not
				 * overwritten here. Overwriting would show the just-arrived value as saved. If the tab closed
				 * in that gap, the user would lose a value they had read as saved.
				 */
				this.state = {
					status: "saved",
					error: null,
					pending: this.desired !== null,
				};
			} catch (error) {
				this.metrics.failures += 1;
				/**
				 * A failed snapshot is not re-queued: the desired value stays as it is. Retry comes from the
				 * next commit or an explicit flush. Retrying immediately would spin the CPU while storage is
				 * down, and it would rewrite the old failed value instead of the latest one that arrived
				 * meanwhile.
				 */
				if (this.desired === null) this.desired = snapshot;
				this.state = {
					status: "failed",
					error: describe(error),
					pending: true,
				};
				this.changed();
				return;
			}
			this.changed();
		}
	}

	/** Waits until the current desired value is saved. Failure stays a state and does not throw. */
	async flush(): Promise<void> {
		this.pump();
		while (this.inFlight !== null) await this.inFlight;
	}

	/** Retries the last failure, writing only the latest value. */
	retry(): void {
		this.pump();
	}
}

/**
 * The coordinator for this session. The play surface creates one and attaches it to the session. It
 * knows nothing of React. Web workers, the main thread, native WebView sessions and tests all use
 * the same object.
 */
export class RuntimeSaveCoordinator {
	private readonly playthroughLane: SaveLane<RuntimeStoryStateSnapshot>;
	private readonly persistentLane: SaveLane<RuntimePersistentStateSnapshot>;
	private disposed = false;
	private readonly clock: RuntimeSaveClock;

	constructor(options: RuntimeSaveCoordinatorOptions) {
		this.clock = options.clock ?? {
			now: () => new Date().toISOString(),
		};
		const notify = (): void => options.onStateChange?.(this.state());
		this.playthroughLane = new SaveLane(async (snapshot) => {
			assertWritable(snapshot);
			await options.store.putPlaythrough({
				storyId: options.storyId,
				slot: options.slot ?? DEFAULT_RUNTIME_SAVE_SLOT,
				snapshot,
				updatedAt: this.clock.now(),
			});
			options.onWritten?.();
		}, notify);
		this.persistentLane = new SaveLane(async (snapshot) => {
			assertWritable(snapshot);
			await options.store.putPersistent({
				storyId: options.storyId,
				snapshot,
				updatedAt: this.clock.now(),
			});
			options.onWritten?.();
		}, notify);
	}

	state(): RuntimeSaveState {
		return {
			playthrough: this.playthroughLane.snapshotState(),
			persistent: this.persistentLane.snapshotState(),
		};
	}

	metrics(): {
		playthrough: RuntimeSaveMetrics;
		persistent: RuntimeSaveMetrics;
	} {
		return {
			playthrough: { ...this.playthroughLane.metrics },
			persistent: { ...this.persistentLane.metrics },
		};
	}

	/** The runtime committed playthrough state. Synchronous and never throws. */
	storyStateCommitted(snapshot: RuntimeStoryStateSnapshot): void {
		if (this.disposed) return;
		this.playthroughLane.offer(snapshot);
	}

	persistentStateCommitted(snapshot: RuntimePersistentStateSnapshot): void {
		if (this.disposed) return;
		this.persistentLane.offer(snapshot);
	}

	retry(): void {
		if (this.disposed) return;
		this.playthroughLane.retry();
		this.persistentLane.retry();
	}

	/**
	 * Waits for the current desired value to be saved, but not forever. The timeout is a parameter
	 * because callers differ: leaving a screen should be short, while an explicit reset waits to the
	 * end. Hitting the timeout does not throw. The desired value stays and is written at the next
	 * opportunity.
	 */
	async flush(timeoutMs?: number): Promise<void> {
		const work = Promise.all([
			this.playthroughLane.flush(),
			this.persistentLane.flush(),
		]).then(() => undefined);
		const delay = this.clock.delay;
		if (timeoutMs === undefined || delay === undefined) return work;
		await Promise.race([work, delay.call(this.clock, timeoutMs)]);
	}

	/**
	 * Releases the coordinator. Commits after this point write nothing. The order matters at an
	 * account switch: the flag closes the path by which a late snapshot from the previous member would
	 * be written to the new scope's database.
	 */
	async dispose(timeoutMs?: number): Promise<void> {
		if (this.disposed) return;
		await this.flush(timeoutMs);
		this.disposed = true;
	}

	get isDisposed(): boolean {
		return this.disposed;
	}
}
