import type { RuntimePersistentStateSnapshot } from "@rowcat/runtime-host/persistent-state";
import type { RuntimeStoryStateSnapshot } from "@rowcat/runtime-host/story-state";
import { describe, expect, it } from "vitest";
import {
	createRuntimePlayerLifecycle,
	type RuntimePlayerLifecycle,
	type RuntimePlayerLifecycleEvent,
	type RuntimePlayerSessionStart,
} from "./lifecycle.ts";
import { createRuntimePlayerPersistence } from "./player.ts";
import { createMemorySaveStore, type MemorySaveStore } from "./testing.ts";

/**
 * Phase 7 closing regression check: makes the race between two coordinators deterministic. The
 * store's gate and open hooks hold writes, so the test does not depend on timing. The sessions are
 * fakes that mimic only the owner's shape, not a real VM. The same scenario on real QuickJS runs in
 * the web's runtime-player-lifecycle.test.ts. This file answers one question about order: can a new
 * owner read or clear the scope before the old owner has finished?
 */

const story = (chapter: number): RuntimeStoryStateSnapshot => ({
	formatVersion: 1,
	entries: [{ key: "run", version: 1, value: { chapter } }],
});

const meta = (endings: string[]): RuntimePersistentStateSnapshot => ({
	formatVersion: 1,
	entries: [{ key: "meta", version: 1, value: { endings } }],
});

const EMPTY: RuntimeStoryStateSnapshot = { formatVersion: 1, entries: [] };

const clock = () => {
	let tick = 0;
	return {
		now: () => new Date(1_800_000_000_000 + tick++).toISOString(),
	};
};

/**
 * A session: remembers its start snapshot, forwards commits to storage, and can be awaited on stop.
 */
interface FakeSession {
	token: number;
	hydrated: {
		story: RuntimeStoryStateSnapshot;
		meta: RuntimePersistentStateSnapshot;
	};
	commit(chapter: number): void;
	unlock(endings: string[]): void;
	stopped: boolean;
	released: boolean;
	/** Holds the stop. The cleanup function runs during this time; releaseStop lets it finish. */
	holdStop(): void;
	releaseStop(): void;
}

interface Harness {
	lifecycle: RuntimePlayerLifecycle;
	sessions: FakeSession[];
	events: RuntimePlayerLifecycleEvent[];
	/**
	 * The maximum number of simultaneously alive (not stopped) sessions. It must stay at 1 or below.
	 */
	maxAlive: () => number;
	last: () => FakeSession;
}

function harness(store: MemorySaveStore, storyId = "story-1"): Harness {
	const sessions: FakeSession[] = [];
	const events: RuntimePlayerLifecycleEvent[] = [];
	let maxAlive = 0;
	const alive = () => sessions.filter((session) => !session.stopped).length;
	const lifecycle = createRuntimePlayerLifecycle({
		scope: () => ({ store, storyId }),
		createPersistence: (scope) =>
			createRuntimePlayerPersistence({
				store: scope.store,
				storyId: scope.storyId,
				clock: clock(),
			}),
		startSession(start: RuntimePlayerSessionStart) {
			const session: FakeSession = {
				token: start.token,
				hydrated: { story: start.storyState, meta: start.persistentState },
				commit: (chapter) =>
					start.persistence.storyStateCommitted(story(chapter)),
				unlock: (endings) =>
					start.persistence.persistentStateCommitted(meta(endings)),
				stopped: false,
				released: false,
				holdStop() {
					held = new Promise<void>((resolve) => {
						releaseHeld = resolve;
					});
				},
				releaseStop() {
					releaseHeld?.();
					held = null;
				},
			};
			let held: Promise<void> | null = null;
			let releaseHeld: (() => void) | null = null;
			sessions.push(session);
			maxAlive = Math.max(maxAlive, alive());
			return {
				async stop() {
					if (held !== null) await held;
					session.stopped = true;
				},
				release() {
					session.released = true;
				},
			};
		},
		onEvent: (event) => events.push(event),
	});
	return {
		lifecycle,
		sessions,
		events,
		maxAlive: () => maxAlive,
		last: () => sessions[sessions.length - 1] as FakeSession,
	};
}

/** Drains microtasks enough that nothing can proceed except the held writes. */
const drain = async (): Promise<void> => {
	for (let i = 0; i < 50; i++) await Promise.resolve();
};

/** Checks by value that settled() has not finished yet. */
const stillRunning = async (
	lifecycle: RuntimePlayerLifecycle,
): Promise<boolean> => {
	let settled = false;
	void lifecycle.settled().then(() => {
		settled = true;
	});
	await drain();
	return !settled;
};

const seeded = async (chapter: number, endings: string[] = []) => {
	const store = createMemorySaveStore({ initialSyncDone: true });
	await store.putPlaythrough({
		storyId: "story-1",
		snapshot: story(chapter),
		updatedAt: "t",
	});
	if (endings.length > 0)
		await store.putPersistent({
			storyId: "story-1",
			snapshot: meta(endings),
			updatedAt: "t",
		});
	return store;
};

describe("restart: the old owner's last write does not race the new owner's read", () => {
	/**
	 * This is exactly the scenario from §14. Old behavior: restart created a new coordinator at once
	 * and called load(). That read chapter 1 ahead of the held chapter-2 write, so the new VM started
	 * from chapter 1.
	 */
	it("the next session stands on that value only after the held write finishes", async () => {
		const store = await seeded(1);
		const h = harness(store);
		h.lifecycle.start();
		await h.lifecycle.settled();
		expect(h.sessions).toHaveLength(1);
		expect(h.last().hydrated.story).toEqual(story(1));

		store.gateNext();
		h.last().commit(2);
		h.lifecycle.restart();
		expect(await stillRunning(h.lifecycle)).toBe(true);
		/** The old owner has not finished, so no new session started and storage was not read. */
		expect(h.sessions).toHaveLength(1);
		expect(h.sessions[0]?.stopped).toBe(true);

		store.open();
		await h.lifecycle.settled();
		expect(h.sessions).toHaveLength(2);
		expect(h.last().hydrated.story).toEqual(story(2));
		expect(h.sessions[0]?.released).toBe(true);
		expect(h.maxAlive()).toBe(1);
	});

	it("restart carries over both lifetimes", async () => {
		const store = await seeded(3, ["bad-end"]);
		const h = harness(store);
		h.lifecycle.start();
		await h.lifecycle.settled();
		h.last().commit(4);
		h.last().unlock(["bad-end", "true-end"]);
		h.lifecycle.restart();
		await h.lifecycle.settled();
		expect(h.last().hydrated.story).toEqual(story(4));
		expect(h.last().hydrated.meta).toEqual(meta(["bad-end", "true-end"]));
	});

	/** Storage is not read while VM cleanup is still running. Stop comes before flush. */
	it("neither flushing nor reading starts before VM cleanup finishes", async () => {
		const store = await seeded(1);
		const h = harness(store);
		h.lifecycle.start();
		await h.lifecycle.settled();
		const first = h.last();
		first.holdStop();
		h.lifecycle.restart();
		await drain();
		/** The cleanup function changed state once more: a commit that arrives before stop completes. */
		first.commit(7);
		expect(h.sessions).toHaveLength(1);
		expect(await stillRunning(h.lifecycle)).toBe(true);
		first.releaseStop();
		await h.lifecycle.settled();
		expect(h.sessions).toHaveLength(2);
		expect(h.last().hydrated.story).toEqual(story(7));
	});
});

describe("reset play: the reset is written only after the old owner finishes", () => {
	/**
	 * This is the scenario from §15 and §16. Old behavior: the empty-snapshot write and the old
	 * session's last write arrived together, and whichever finished later won. Reset could leave old
	 * progress, or the reverse.
	 */
	it("an empty playthrough is written after the old session's last save, and closing and reopening gives the initial state", async () => {
		const store = await seeded(3, ["bad-end"]);
		const h = harness(store);
		h.lifecycle.start();
		await h.lifecycle.settled();
		h.last().commit(5);
		await h.lifecycle.persistence()?.flush();

		/**
		 * Holds only the old session's last write. The reset's empty write is not held. Under the old
		 * behavior, which did not wait for the old owner, the empty write would commit first and chapter
		 * 8 would overwrite it.
		 */
		store.gateNext();
		h.last().commit(8);
		h.lifecycle.resetPlaythrough();
		expect(await stillRunning(h.lifecycle)).toBe(true);
		expect(h.sessions).toHaveLength(1);
		/** The reset's write has not happened yet, because the old owner has not finished. */
		expect(store.writes.filter((w) => w.kind === "playthrough")).toHaveLength(
			2,
		);

		store.open();
		await h.lifecycle.settled();
		const playthroughWrites = store.writes
			.filter((w) => w.kind === "playthrough")
			.map((w) => w.snapshot);
		/**
		 * Chapter 8 (the old session's last) then the empty snapshot (reset). If the order flipped, the
		 * reset would be erased.
		 */
		expect(playthroughWrites.slice(-2)).toEqual([story(8), EMPTY]);
		expect(h.sessions).toHaveLength(2);
		expect(h.last().hydrated.story).toEqual(EMPTY);
		expect(h.last().hydrated.meta).toEqual(meta(["bad-end"]));

		/**
		 * Close fully, then a new instance opens. Reset is a fact of storage, not a state of the VM's
		 * screen.
		 */
		h.lifecycle.teardown();
		await h.lifecycle.settled();
		expect(h.last().stopped).toBe(true);
		expect(h.last().released).toBe(true);

		const reopened = harness(store);
		reopened.lifecycle.start();
		await reopened.lifecycle.settled();
		expect(reopened.last().hydrated.story).toEqual(EMPTY);
		expect(reopened.last().hydrated.meta).toEqual(meta(["bad-end"]));
		expect((await store.getPlaythrough("story-1"))?.snapshot).toEqual(EMPTY);
		expect((await store.getPersistent("story-1"))?.snapshot).toEqual(
			meta(["bad-end"]),
		);
	});

	it("the old session's commits after the reset write nothing", async () => {
		const store = await seeded(2);
		const h = harness(store);
		h.lifecycle.start();
		await h.lifecycle.settled();
		const old = h.last();
		h.lifecycle.resetPlaythrough();
		await h.lifecycle.settled();
		/** A late commit reaching a retired coordinator. The generation is the gate. */
		old.commit(9);
		await drain();
		expect((await store.getPlaythrough("story-1"))?.snapshot).toEqual(EMPTY);
	});
});

describe("rapid consecutive requests", () => {
	it("restart · restart · reset · restart: one owner at a time, and the result is the initial state", async () => {
		const store = await seeded(4, ["x"]);
		const h = harness(store);
		h.lifecycle.start();
		await h.lifecycle.settled();
		h.last().commit(5);

		h.lifecycle.restart();
		h.lifecycle.restart();
		h.lifecycle.resetPlaythrough();
		h.lifecycle.restart();
		await h.lifecycle.settled();

		expect(h.maxAlive()).toBe(1);
		/** No intermediate session is created: the merged requests start one final session. */
		expect(h.sessions).toHaveLength(2);
		expect(h.last().hydrated.story).toEqual(EMPTY);
		expect(h.last().hydrated.meta).toEqual(meta(["x"]));
		for (const session of h.sessions.slice(0, -1)) {
			expect(session.stopped).toBe(true);
			expect(session.released).toBe(true);
		}
		expect(h.last().stopped).toBe(false);
		/** The old session does not come back to life. */
		h.sessions[0]?.commit(99);
		await drain();
		expect((await store.getPlaythrough("story-1"))?.snapshot).toEqual(EMPTY);
	});

	it("when leaving comes last, nothing stands up", async () => {
		const store = await seeded(1);
		const h = harness(store);
		h.lifecycle.start();
		h.lifecycle.restart();
		h.lifecycle.teardown();
		await h.lifecycle.settled();
		expect(h.sessions.filter((s) => !s.stopped)).toHaveLength(0);
		expect(h.events.at(-1)).toEqual({ type: "idle" });
	});

	/**
	 * A leave immediately after a reset still writes the empty playthrough. The request is not
	 * discarded.
	 */
	it("leaving right after a reset also writes an empty playthrough", async () => {
		const store = await seeded(6);
		const h = harness(store);
		h.lifecycle.start();
		await h.lifecycle.settled();
		h.lifecycle.resetPlaythrough();
		h.lifecycle.teardown();
		await h.lifecycle.settled();
		expect(h.sessions).toHaveLength(1);
		expect((await store.getPlaythrough("story-1"))?.snapshot).toEqual(EMPTY);
	});

	/** StrictMode double mount: start, teardown and start produce one session. */
	it("start · teardown · start is one session", async () => {
		const store = await seeded(1);
		const h = harness(store);
		h.lifecycle.start();
		h.lifecycle.teardown();
		h.lifecycle.start();
		await h.lifecycle.settled();
		expect(h.sessions).toHaveLength(1);
		expect(h.last().stopped).toBe(false);
	});
});

describe("other instances of the same scope", () => {
	/**
	 * Leaving a screen and reopening it at once means two hook instances. If the new instance reads
	 * before the old instance's flush finishes, the same race returns at the route boundary.
	 */
	it("the later instance reads after the earlier one finishes leaving", async () => {
		const store = await seeded(1);
		const a = harness(store);
		a.lifecycle.start();
		await a.lifecycle.settled();
		store.gate();
		a.last().commit(2);
		a.lifecycle.teardown();

		const b = harness(store);
		b.lifecycle.start();
		expect(await stillRunning(b.lifecycle)).toBe(true);
		expect(b.sessions).toHaveLength(0);

		store.open();
		await a.lifecycle.settled();
		await b.lifecycle.settled();
		expect(b.last().hydrated.story).toEqual(story(2));
	});
});

describe("save failures during a transition", () => {
	/**
	 * §18: if the flush fails, do not start. Starting from the stored value would silently drop the
	 * progress the screen showed, and an old write could revert the reset later.
	 */
	it("failing to finish the old save blocks, and a retry continues that transition", async () => {
		const store = await seeded(1);
		const h = harness(store);
		h.lifecycle.start();
		await h.lifecycle.settled();
		store.failNext("disk is gone");
		h.last().commit(2);
		h.lifecycle.restart();
		await h.lifecycle.settled();

		expect(h.sessions).toHaveLength(1);
		expect(h.sessions[0]?.stopped).toBe(true);
		expect(h.lifecycle.isBlocked()).toBe(true);
		expect(h.events.at(-1)).toMatchObject({ type: "blocked", stage: "flush" });
		/** Save state reports the failure. This is what the existing retry UI relies on. */
		expect(h.lifecycle.persistence()?.state().playthrough.status).toBe(
			"failed",
		);
		expect((await store.getPlaythrough("story-1"))?.snapshot).toEqual(story(1));

		h.lifecycle.retrySave();
		await h.lifecycle.settled();
		expect(h.lifecycle.isBlocked()).toBe(false);
		expect(h.sessions).toHaveLength(2);
		expect(h.last().hydrated.story).toEqual(story(2));
	});

	it("a reset that couldn't write an empty playthrough does not stand on the old state", async () => {
		const store = await seeded(5);
		const h = harness(store);
		h.lifecycle.start();
		await h.lifecycle.settled();
		store.failNext("disk is gone");
		h.lifecycle.resetPlaythrough();
		await h.lifecycle.settled();
		expect(h.sessions).toHaveLength(1);
		expect(h.lifecycle.isBlocked()).toBe(true);
		expect(h.events.at(-1)).toMatchObject({ type: "blocked", stage: "reset" });

		/** After a blocked reset, `Restart` does not discard that reset. */
		h.lifecycle.restart();
		await h.lifecycle.settled();
		expect(h.sessions).toHaveLength(2);
		expect(h.last().hydrated.story).toEqual(EMPTY);
	});

	it("read failures are reported without a session", async () => {
		const store = createMemorySaveStore({ initialSyncDone: true });
		store.failReads("closed");
		const h = harness(store);
		h.lifecycle.start();
		await h.lifecycle.settled();
		expect(h.sessions).toHaveLength(0);
		expect(h.events.at(-1)).toMatchObject({ type: "load-failed" });
	});
});
