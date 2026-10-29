import type { RuntimePersistentStateSnapshot } from "@rowcat/runtime-host/persistent-state";
import type { RuntimeStoryStateSnapshot } from "@rowcat/runtime-host/story-state";
import { describe, expect, it } from "vitest";
import {
	RuntimeSaveCoordinator,
	type RuntimeSaveScopeState,
	runtimeSaveDurabilityAtRisk,
} from "./coordinator.ts";
import {
	createRuntimePlayerPersistence,
	RUNTIME_PERSISTENCE_ERROR_CODE,
} from "./player.ts";
import { createMemorySaveStore, type MemorySaveStore } from "./testing.ts";

const story = (chapter: number): RuntimeStoryStateSnapshot => ({
	formatVersion: 1,
	entries: [{ key: "run", version: 1, value: { chapter } }],
});

const meta = (endings: string[]): RuntimePersistentStateSnapshot => ({
	formatVersion: 1,
	entries: [{ key: "meta", version: 1, value: { endings } }],
});

const clock = (): { now(): string } => {
	let tick = 0;
	return { now: () => new Date(1_800_000_000_000 + tick++).toISOString() };
};

const coordinatorFor = (store: MemorySaveStore): RuntimeSaveCoordinator =>
	new RuntimeSaveCoordinator({ store, storyId: "story-1", clock: clock() });

describe("write pipeline", () => {
	it("one commit becomes one local record", async () => {
		const store = createMemorySaveStore();
		const coordinator = coordinatorFor(store);
		coordinator.storyStateCommitted(story(1));
		await coordinator.flush();
		const record = await store.getPlaythrough("story-1");
		expect(record?.snapshot).toEqual(story(1));
		expect(record?.dirty).toBe(1);
	});

	/**
	 * Snapshots are full state, so the last one contains everything before it. Writing every
	 * intermediate value would tie storage to commit frequency, and this queue has no upper bound.
	 */
	it("values arriving during a write merge and only the last is written", async () => {
		const store = createMemorySaveStore();
		store.gate();
		const coordinator = coordinatorFor(store);
		coordinator.storyStateCommitted(story(1));
		coordinator.storyStateCommitted(story(2));
		coordinator.storyStateCommitted(story(3));
		coordinator.storyStateCommitted(story(4));
		store.open();
		await coordinator.flush();
		expect(store.writes.map((write) => write.kind)).toEqual([
			"playthrough",
			"playthrough",
		]);
		expect((await store.getPlaythrough("story-1"))?.snapshot).toEqual(story(4));
		expect(coordinator.metrics().playthrough.coalesced).toBeGreaterThan(0);
	});

	/**
	 * If an old snapshot finishes late and overwrites a newer value, the screen and storage diverge.
	 * The symptom vanishes at the next keystroke, so it is almost impossible to reproduce.
	 */
	it("never goes backwards: the saved value is always the newest", async () => {
		const store = createMemorySaveStore();
		const coordinator = coordinatorFor(store);
		for (let chapter = 1; chapter <= 20; chapter++)
			coordinator.storyStateCommitted(story(chapter));
		await coordinator.flush();
		expect((await store.getPlaythrough("story-1"))?.snapshot).toEqual(
			story(20),
		);
	});

	/**
	 * The two lifetimes write independently. Neither waits for the other, and each goes to its own
	 * record.
	 */
	it("the two lifetimes write independently", async () => {
		const store = createMemorySaveStore();
		const coordinator = coordinatorFor(store);
		coordinator.storyStateCommitted(story(2));
		coordinator.persistentStateCommitted(meta(["library"]));
		await coordinator.flush();
		expect((await store.getPlaythrough("story-1"))?.snapshot).toEqual(story(2));
		expect((await store.getPersistent("story-1"))?.snapshot).toEqual(
			meta(["library"]),
		);
	});
});

describe("failures", () => {
	/**
	 * A render that is already drawn cannot be undone when storage fails. Here failure is state, and
	 * the desired latest value stays.
	 */
	it("write failures do not throw and remain as state", async () => {
		const store = createMemorySaveStore();
		store.failNext("disk is gone");
		const coordinator = coordinatorFor(store);
		coordinator.storyStateCommitted(story(3));
		await coordinator.flush();
		expect(coordinator.state().playthrough.status).toBe("failed");
		expect(coordinator.state().playthrough.pending).toBe(true);
		expect(coordinator.metrics().playthrough.failures).toBe(1);
	});

	/** Retry writes only the latest value. It does not replay the failed intermediate values. */
	it("retries with the newest value after a failure", async () => {
		const store = createMemorySaveStore();
		store.failNext("transient");
		const coordinator = coordinatorFor(store);
		coordinator.storyStateCommitted(story(3));
		await coordinator.flush();
		coordinator.storyStateCommitted(story(4));
		await coordinator.flush();
		expect(coordinator.state().playthrough.status).toBe("saved");
		expect((await store.getPlaythrough("story-1"))?.snapshot).toEqual(story(4));
	});

	it("retry rewrites the last failure even without a new commit", async () => {
		const store = createMemorySaveStore();
		store.failNext("transient");
		const coordinator = coordinatorFor(store);
		coordinator.storyStateCommitted(story(3));
		await coordinator.flush();
		coordinator.retry();
		await coordinator.flush();
		expect((await store.getPlaythrough("story-1"))?.snapshot).toEqual(story(3));
	});
});

describe("disposal", () => {
	/**
	 * Closes the path where, after an account switch, a late commit from the previous member writes
	 * into the new scope.
	 */
	it("commits after disposal write nothing", async () => {
		const store = createMemorySaveStore();
		const coordinator = coordinatorFor(store);
		coordinator.storyStateCommitted(story(1));
		await coordinator.dispose();
		coordinator.storyStateCommitted(story(9));
		await coordinator.flush();
		expect((await store.getPlaythrough("story-1"))?.snapshot).toEqual(story(1));
	});
});

describe("loading", () => {
	const persistenceFor = (store: MemorySaveStore) =>
		createRuntimePlayerPersistence({
			store,
			storyId: "story-1",
			clock: clock(),
		});

	it("returns a local save as is", async () => {
		const store = createMemorySaveStore();
		await store.putPlaythrough({
			storyId: "story-1",
			snapshot: story(7),
			updatedAt: "t",
		});
		await store.putPersistent({
			storyId: "story-1",
			snapshot: meta(["a"]),
			updatedAt: "t",
		});
		const resolution = await persistenceFor(store).load();
		expect(resolution).toEqual({
			status: "ready",
			storyState: story(7),
			persistentState: meta(["a"]),
		});
	});

	/**
	 * On a freshly paired device, 'no row' does not mean a new game. Treating the two as one would
	 * start a new game on an account with months of progress, and its first commit would overwrite the
	 * real save.
	 */
	it("sync-required when there is no row and the first sync isn't done", async () => {
		const store = createMemorySaveStore({ initialSyncDone: false });
		expect(await persistenceFor(store).load()).toEqual({
			status: "sync-required",
		});
	});

	it("a new game when the first sync is done and there is no row", async () => {
		const store = createMemorySaveStore({ initialSyncDone: true });
		const resolution = await persistenceFor(store).load();
		expect(resolution.status).toBe("ready");
		if (resolution.status !== "ready") return;
		expect(resolution.storyState.entries).toEqual([]);
		expect(resolution.persistentState.entries).toEqual([]);
	});

	/** If a local save exists, do not wait for the network. */
	it("does not ask about the first sync when a local save exists", async () => {
		const store = createMemorySaveStore({ initialSyncDone: false });
		await store.putPlaythrough({
			storyId: "story-1",
			snapshot: story(2),
			updatedAt: "t",
		});
		expect((await persistenceFor(store).load()).status).toBe("ready");
	});

	/** A corrupt row must not be overwritten. A validation failure must not discard progress. */
	it("reports a corrupt snapshot as a failure and leaves the row as is", async () => {
		const store = createMemorySaveStore({ initialSyncDone: true });
		await store.putPlaythrough({
			storyId: "story-1",
			snapshot: story(3),
			updatedAt: "t",
		});
		store.corruptPlaythrough();
		const resolution = await persistenceFor(store).load();
		expect(resolution.status).toBe("failed");
		if (resolution.status !== "failed") return;
		expect(resolution.error.code).toBe(RUNTIME_PERSISTENCE_ERROR_CODE.corrupt);
		expect(await store.rawPlaythrough("story-1")).not.toBeNull();
	});

	it("reports a failure when the store cannot be read", async () => {
		const store = createMemorySaveStore();
		store.failReads("closed");
		const resolution = await persistenceFor(store).load();
		expect(resolution.status).toBe("failed");
		if (resolution.status !== "failed") return;
		expect(resolution.error.code).toBe(
			RUNTIME_PERSISTENCE_ERROR_CODE.unavailable,
		);
	});
});

describe("reset play", () => {
	/**
	 * The defining check of this slice. Reset advances the playthrough row to an empty snapshot and
	 * leaves the persistent row alone. Deleting the row instead would not propagate, and old progress
	 * would return.
	 */
	it("clears only the playthrough, keeps persistent state, and advances the revision", async () => {
		const store = createMemorySaveStore({ initialSyncDone: true });
		const persistence = createRuntimePlayerPersistence({
			store,
			storyId: "story-1",
			clock: clock(),
		});
		persistence.storyStateCommitted(story(8));
		persistence.persistentStateCommitted(meta(["library"]));
		await persistence.flush();
		const before = await store.getPlaythrough("story-1");

		await persistence.resetPlaythrough();

		const after = await store.getPlaythrough("story-1");
		expect(after?.snapshot.entries).toEqual([]);
		expect(after?.deletedAt).toBeNull();
		expect(after?.dirty).toBe(1);
		expect(after?.rev.t).toBeGreaterThanOrEqual(before?.rev.t ?? 0);
		expect((await store.getPersistent("story-1"))?.snapshot).toEqual(
			meta(["library"]),
		);
	});
});

/**
 * The one condition that makes both apps show the save-failure warning. It is a pure function to
 * prevent copies. If each app wrote its own 'playthrough failed || persistent failed' check, one
 * side could forget a lifetime. The symptom would be a warning that never appears, with no trace on
 * screen.
 */
describe("whether progress is not durable yet", () => {
	const scope = (
		status: RuntimeSaveScopeState["status"],
	): RuntimeSaveScopeState => ({ status, error: null, pending: false });

	it("true when either lifetime failed", () => {
		expect(
			runtimeSaveDurabilityAtRisk({
				playthrough: scope("failed"),
				persistent: scope("saved"),
			}),
		).toBe(true);
		expect(
			runtimeSaveDurabilityAtRisk({
				playthrough: scope("saved"),
				persistent: scope("failed"),
			}),
		).toBe(true);
		/**
		 * If both lifetimes fail there is still one warning, because the user's action is the same either
		 * way.
		 */
		expect(
			runtimeSaveDurabilityAtRisk({
				playthrough: scope("failed"),
				persistent: scope("failed"),
			}),
		).toBe(true);
	});

	it("writing and saved states are not warnings", () => {
		for (const status of ["idle", "saving", "saved"] as const)
			expect(
				runtimeSaveDurabilityAtRisk({
					playthrough: scope(status),
					persistent: scope(status),
				}),
				status,
			).toBe(false);
	});

	/** With no coordinator there is no failure either. The screen passes null through. */
	it("false without state", () => {
		expect(runtimeSaveDurabilityAtRisk(null)).toBe(false);
		expect(runtimeSaveDurabilityAtRisk(undefined)).toBe(false);
	});
});
