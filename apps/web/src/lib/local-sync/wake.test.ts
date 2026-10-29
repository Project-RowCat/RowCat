import type { SyncWakeEvent } from "@rowcat/contracts";
import { RowCatApiError } from "@rowcat/sdk";
import type { SyncController, SyncReason, SyncSnapshot } from "@rowcat/sync";
import { afterEach, describe, expect, it } from "vitest";
import type { AutoSyncSnapshot, WebAutoSync } from "./auto-sync.ts";
import type { SyncWakeStream } from "./transport.ts";
import { createWebSyncWake, type WebSyncWake } from "./wake.ts";

/**
 * Lifetime of the wake stream: connection conditions, reconnection, and account isolation.
 * - Not checked here: debounce, single run, follow-up, and backoff (covered by
 *   packages/sync/src/auto-sync.test.ts with a controlled clock); SSE framing (covered by
 *   packages/sdk/src/sse.test.ts).
 * - Checked here: when to open and close (locked, disabled, offline, account switch); that a wake
 *   triggers exactly one requestSync("remote-wake"); that the local cursor is only read; that
 *   reconnects use capped backoff and that 401 stops retries.
 */

/** One stream opening. Tests push frames into it by hand. */
class Opening {
	private queue: SyncWakeEvent[] = [];
	private wake: (() => void) | null = null;
	private ended = false;
	private failure: unknown = null;
	aborted = false;

	constructor(readonly signal: AbortSignal) {
		signal.addEventListener("abort", () => {
			this.aborted = true;
			this.end();
		});
	}

	emit(cursor: number): void {
		this.queue.push({ cursor });
		this.resume();
	}
	end(): void {
		this.ended = true;
		this.resume();
	}
	fail(error: unknown): void {
		this.failure = error;
		this.ended = true;
		this.resume();
	}
	private resume(): void {
		const resume = this.wake;
		this.wake = null;
		resume?.();
	}

	async *iterate(): AsyncGenerator<SyncWakeEvent> {
		for (;;) {
			while (this.queue.length > 0) yield this.queue.shift() as SyncWakeEvent;
			if (this.failure !== null) {
				const error = this.failure;
				this.failure = null;
				throw error;
			}
			if (this.ended) return;
			await new Promise<void>((resolve) => {
				this.wake = resolve;
			});
		}
	}
}

class FakeStream {
	readonly openings: Opening[] = [];
	readonly open: SyncWakeStream = (signal) => {
		const opening = new Opening(signal);
		this.openings.push(opening);
		return opening.iterate();
	};
	get count(): number {
		return this.openings.length;
	}
	get last(): Opening {
		const opening = this.openings.at(-1);
		if (!opening) throw new Error("no stream is open yet");
		return opening;
	}
}

/** A clock turned by hand. Backoff delays are never actually waited on. */
function fakeTimers() {
	let now = 0;
	let nextId = 0;
	const pending = new Map<number, { at: number; run: () => void }>();
	return {
		clock: {
			setTimeout(run: () => void, ms: number) {
				const id = ++nextId;
				pending.set(id, { at: now + ms, run });
				return id;
			},
			clearTimeout(handle: unknown) {
				pending.delete(handle as number);
			},
			now: () => now,
			// Pins jitter at 1.0x so the backoff values themselves can be asserted.
			random: () => 0.5,
		},
		advance(ms: number) {
			now += ms;
			for (const [id, timer] of [...pending])
				if (timer.at <= now) {
					pending.delete(id);
					timer.run();
				}
		},
		count: () => pending.size,
	};
}

class FakeController {
	private snap: SyncSnapshot = {
		state: "idle",
		trusted: false,
		initialSyncDone: false,
		lastSyncedAt: null,
		lastError: null,
	};
	private listeners = new Set<() => void>();
	/** A value of 1 means P0: wake must never call the controller directly. */
	syncNowCalls = 0;

	snapshot = (): SyncSnapshot => this.snap;
	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};
	set(patch: Partial<SyncSnapshot>): void {
		this.snap = { ...this.snap, ...patch };
		for (const listener of this.listeners) listener();
	}
	syncNow = async () => {
		this.syncNowCalls += 1;
		return null;
	};
	get port(): SyncController {
		return this as unknown as SyncController;
	}
}

class FakeAutoSync {
	private snap: AutoSyncSnapshot = {
		phase: "idle",
		lastSuccessAt: null,
		errorCategory: null,
		reason: null,
		enabled: true,
	};
	private listeners = new Set<() => void>();
	readonly requests: SyncReason[] = [];

	snapshot = (): AutoSyncSnapshot => this.snap;
	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	};
	requestSync = (reason: SyncReason): void => {
		this.requests.push(reason);
	};
	setEnabled(enabled: boolean): void {
		this.snap = { ...this.snap, enabled };
		for (const listener of this.listeners) listener();
	}
	get port(): WebAutoSync {
		return this as unknown as WebAutoSync;
	}
}

const flush = async (rounds = 20): Promise<void> => {
	for (let i = 0; i < rounds; i++) await Promise.resolve();
};

interface Harness {
	wake: WebSyncWake;
	stream: FakeStream;
	controller: FakeController;
	autoSync: FakeAutoSync;
	timers: ReturnType<typeof fakeTimers>;
	/** The last cursor this device actually applied. Tests move it directly. */
	localCursor: { value: number; reads: number; fail: boolean };
	owned: { value: boolean };
	online: { value: boolean };
}

let live: WebSyncWake[] = [];
afterEach(() => {
	for (const wake of live) wake.stop();
	live = [];
});

function harness(): Harness {
	const stream = new FakeStream();
	const controller = new FakeController();
	const autoSync = new FakeAutoSync();
	const timers = fakeTimers();
	const localCursor = { value: 0, reads: 0, fail: false };
	const owned = { value: true };
	const online = { value: true };

	const wake = createWebSyncWake({
		controller: controller.port,
		autoSync: autoSync.port,
		open: stream.open,
		readLocalCursor: async () => {
			localCursor.reads += 1;
			if (localCursor.fail) throw new Error("the database closed");
			return localCursor.value;
		},
		ownsStore: () => owned.value,
		isOnline: () => online.value,
		timers: timers.clock,
	});
	live.push(wake);
	return {
		wake,
		stream,
		controller,
		autoSync,
		timers,
		localCursor,
		owned,
		online,
	};
}

/** Makes the device runnable: the key is in memory and auto sync is on. */
const makeReady = (h: Harness): void =>
	h.controller.set({ state: "ready", trusted: true });

describe("when it connects", () => {
	it("does not open while locked; a wake could not pull", () => {
		const h = harness();
		h.wake.start();
		expect(h.stream.count).toBe(0);
		expect(h.wake.connected()).toBe(false);
	});

	it("does not open if sync was never set up", () => {
		const h = harness();
		h.controller.set({ state: "disabled", trusted: false });
		h.wake.start();
		expect(h.stream.count).toBe(0);
	});

	it("connects the moment keys exist", () => {
		const h = harness();
		h.wake.start();
		expect(h.stream.count).toBe(0);

		makeReady(h);
		expect(h.stream.count).toBe(1);
		expect(h.wake.connected()).toBe(true);
	});

	/**
	 * While a sync runs, the state becomes `syncing`. Including that in the connection condition would
	 * reconnect the stream on every sync. The server subscription bookkeeping churns, and commits made
	 * in between are missed.
	 */
	it("does not disconnect while syncing", () => {
		const h = harness();
		h.wake.start();
		makeReady(h);
		const first = h.stream.last;

		h.controller.set({ state: "syncing" });
		h.controller.set({ state: "ready" });

		expect(h.stream.count).toBe(1);
		expect(first.aborted).toBe(false);
	});

	it("disconnects when trust is lost (locked)", () => {
		const h = harness();
		h.wake.start();
		makeReady(h);
		const opening = h.stream.last;

		h.controller.set({ state: "locked", trusted: false });
		expect(opening.aborted).toBe(true);
		expect(h.wake.connected()).toBe(false);
	});

	it("reconnects on unlock", () => {
		const h = harness();
		h.wake.start();
		makeReady(h);
		h.controller.set({ state: "locked", trusted: false });
		expect(h.stream.count).toBe(1);

		makeReady(h);
		expect(h.stream.count).toBe(2);
	});

	/**
	 * §92. A user who turned auto sync off must not receive remote changes automatically. Keeping the
	 * connection open and ignoring events is the alternative, but it leaves a connection open that
	 * does nothing, and it contradicts the user's choice to keep auto sync off.
	 */
	it("does not open while automatic sync is off", () => {
		const h = harness();
		h.autoSync.setEnabled(false);
		h.wake.start();
		makeReady(h);
		expect(h.stream.count).toBe(0);
	});

	it("turning automatic sync off closes the open stream", () => {
		const h = harness();
		h.wake.start();
		makeReady(h);
		const opening = h.stream.last;

		h.autoSync.setEnabled(false);
		expect(opening.aborted).toBe(true);
		expect(h.wake.connected()).toBe(false);
	});

	/**
	 * §93. Turning auto sync back on reconnects. Remote changes that accumulated in between are
	 * fetched by the `enabled` run of auto sync.
	 */
	it("turning automatic sync back on connects", () => {
		const h = harness();
		h.wake.start();
		makeReady(h);
		h.autoSync.setEnabled(false);
		expect(h.stream.count).toBe(1);

		h.autoSync.setEnabled(true);
		expect(h.stream.count).toBe(2);
	});

	it("does not open offline, and attaches once online", () => {
		const h = harness();
		h.online.value = false;
		h.wake.start();
		makeReady(h);
		expect(h.stream.count).toBe(0);

		h.online.value = true;
		h.controller.set({ state: "ready" });
		expect(h.stream.count).toBe(1);
	});

	it("does not open if this scope is not mine", () => {
		const h = harness();
		h.owned.value = false;
		h.wake.start();
		makeReady(h);
		expect(h.stream.count).toBe(0);
	});

	it("`start()` is idempotent; StrictMode's double mount does not make two connections", () => {
		const h = harness();
		h.wake.start();
		h.wake.start();
		makeReady(h);
		h.wake.start();
		expect(h.stream.count).toBe(1);
	});

	/**
	 * StrictMode's mount → unmount → mount. If the old stream survives, the server subscription
	 * doubles, and one copy receives only heartbeats that nobody reads.
	 */
	it("after `start → stop → start` one connection is alive", () => {
		const h = harness();
		h.wake.start();
		makeReady(h);
		const first = h.stream.last;

		h.wake.stop();
		expect(first.aborted).toBe(true);

		h.wake.start();
		expect(h.stream.count).toBe(2);
		expect(h.stream.last.aborted).toBe(false);
		expect(h.timers.count()).toBe(0);
	});
});

describe("what a wake does", () => {
	/**
	 * The bridge is one line: calling the controller directly would skip single-run and backoff.
	 */
	it("hands `remote-wake` to automatic sync and does not call the controller directly", async () => {
		const h = harness();
		h.wake.start();
		makeReady(h);

		h.stream.last.emit(5);
		await flush();

		expect(h.autoSync.requests).toEqual(["remote-wake"]);
		expect(h.controller.syncNowCalls).toBe(0);
	});

	/**
	 * §29. Writing the cursor that SSE provides into local storage would make the device skip records
	 * it never downloaded, permanently. This lifecycle manager has no write capability (its port is
	 * only `readLocalCursor`), and the test checks that as a value.
	 */
	it("does not advance the local cursor", async () => {
		const h = harness();
		h.wake.start();
		makeReady(h);

		h.stream.last.emit(99);
		await flush();

		expect(h.localCursor.value).toBe(0);
		expect(h.autoSync.requests).toEqual(["remote-wake"]);
	});

	/**
	 * §56. If the cursor is already applied, there is nothing to pull. This filters out the echo of
	 * the device's own push.
	 */
	it("does not wake for an already applied cursor", async () => {
		const h = harness();
		h.localCursor.value = 12;
		h.wake.start();
		makeReady(h);

		h.stream.last.emit(12);
		h.stream.last.emit(11);
		await flush();
		expect(h.autoSync.requests).toEqual([]);

		h.stream.last.emit(13);
		await flush();
		expect(h.autoSync.requests).toEqual(["remote-wake"]);
	});

	/** §28. When in doubt, wake. One wasted pull costs less than a missed remote change. */
	it("wakes anyway if the local cursor cannot be read", async () => {
		const h = harness();
		h.localCursor.fail = true;
		h.wake.start();
		makeReady(h);

		h.stream.last.emit(1);
		await flush();
		expect(h.autoSync.requests).toEqual(["remote-wake"]);
	});

	/**
	 * §90. The same cursor arriving several times (for example, the initial frame on reconnect) must
	 * not increase requests.
	 */
	it("a duplicate cursor wakes once", async () => {
		const h = harness();
		h.wake.start();
		makeReady(h);

		h.stream.last.emit(10);
		await flush();
		// Already applied, so the further 10s are all ignored.
		h.localCursor.value = 10;
		h.stream.last.emit(10);
		h.stream.last.emit(10);
		await flush();

		expect(h.autoSync.requests).toEqual(["remote-wake"]);
	});

	/**
	 * §91. Even if 100 arrive, this layer only forwards requests. The coordinator is what prevents
	 * concurrent runs. This test confirms two things: no second debounce layer was added, and every
	 * request goes out with the same reason.
	 */
	it("even in a flood there is one reason and the controller is still not called", async () => {
		const h = harness();
		h.wake.start();
		makeReady(h);

		for (let i = 1; i <= 100; i++) h.stream.last.emit(i);
		await flush(300);

		expect(h.autoSync.requests.length).toBeGreaterThan(0);
		expect(new Set(h.autoSync.requests)).toEqual(new Set(["remote-wake"]));
		expect(h.controller.syncNowCalls).toBe(0);
	});
});

describe("how it reattaches after a drop", () => {
	it("when the server closes the stream it reattaches after backoff", async () => {
		const h = harness();
		h.wake.start();
		makeReady(h);

		h.stream.last.end();
		await flush();
		// Does not reconnect immediately. That is the definition of a hot loop.
		expect(h.stream.count).toBe(1);

		h.timers.advance(1_000);
		await flush();
		expect(h.stream.count).toBe(2);
	});

	it("repeated failures grow the wait up to the cap and stop there", async () => {
		const h = harness();
		h.wake.start();
		makeReady(h);

		const waits = [1_000, 2_000, 5_000, 10_000, 30_000, 30_000];
		for (const [index, wait] of waits.entries()) {
			h.stream.last.fail(
				new RowCatApiError({ status: 503, code: "x", message: "y" }),
			);
			await flush();
			expect(h.stream.count).toBe(index + 1);

			// Does not reconnect before the wait has fully elapsed.
			h.timers.advance(wait - 1);
			await flush();
			expect(h.stream.count).toBe(index + 1);

			h.timers.advance(1);
			await flush();
			expect(h.stream.count).toBe(index + 2);
		}
	});

	/**
	 * A connection that receives one frame and is then cut (by a server or a proxy that truncates
	 * streams) must not reset the counter just because a frame arrived. That would effectively remove
	 * backoff. Only a connection that stays alive past the heartbeat interval counts as healthy.
	 */
	it("a short-lived connection does not reset the backoff", async () => {
		const h = harness();
		h.wake.start();
		makeReady(h);

		h.stream.last.emit(1);
		await flush();
		h.stream.last.end();
		await flush();
		h.timers.advance(1_000);
		await flush();
		expect(h.stream.count).toBe(2);

		// The second connection also drops immediately, so the wait must be 2 seconds, not 1.
		h.stream.last.end();
		await flush();
		h.timers.advance(1_999);
		await flush();
		expect(h.stream.count).toBe(2);
		h.timers.advance(1);
		await flush();
		expect(h.stream.count).toBe(3);
	});

	it("a long-lived connection resets the backoff", async () => {
		const h = harness();
		h.wake.start();
		makeReady(h);

		h.stream.last.end();
		await flush();
		h.timers.advance(1_000);
		await flush();
		expect(h.stream.count).toBe(2);

		h.timers.advance(60_000);
		h.stream.last.end();
		await flush();
		h.timers.advance(1_000);
		await flush();
		expect(h.stream.count).toBe(3);
	});

	/**
	 * Health is measured by how long the connection lived, not by how it ended. A connection that
	 * lived an hour and then dropped with an error when switching Wi-Fi is the most common ending. If
	 * the earlier failure count carried over, this device would wait 30 seconds, during which changes
	 * from other devices cannot wake it.
	 */
	it("a long-lived connection that drops **with an error** resets the backoff too", async () => {
		const h = harness();
		h.wake.start();
		makeReady(h);

		for (const wait of [1_000, 2_000, 5_000]) {
			h.stream.last.fail(
				new RowCatApiError({ status: 503, code: "x", message: "y" }),
			);
			await flush();
			h.timers.advance(wait);
			await flush();
		}
		expect(h.stream.count).toBe(4);

		h.timers.advance(60_000);
		h.stream.last.fail(new TypeError("network error"));
		await flush();
		h.timers.advance(999);
		await flush();
		expect(h.stream.count).toBe(4);
		h.timers.advance(1);
		await flush();
		expect(h.stream.count).toBe(5);
	});

	/**
	 * §115. 401 and 403 get the same answer however often the same request is sent. Backing off only
	 * drains battery, and the real problem (the user must sign in again) never reaches the user.
	 */
	it("401 does not reconnect", async () => {
		const h = harness();
		h.wake.start();
		makeReady(h);

		h.stream.last.fail(
			new RowCatApiError({
				status: 401,
				code: "login_required",
				message: "Sign-in required.",
			}),
		);
		await flush();

		h.timers.advance(600_000);
		await flush();
		expect(h.stream.count).toBe(1);
		expect(h.timers.count()).toBe(0);
	});

	it("403 does not reconnect either", async () => {
		const h = harness();
		h.wake.start();
		makeReady(h);
		h.stream.last.fail(
			new RowCatApiError({
				status: 403,
				code: "account_restricted",
				message: "the account is restricted",
			}),
		);
		await flush();
		h.timers.advance(600_000);
		await flush();
		expect(h.stream.count).toBe(1);
	});

	/**
	 * §58. Three hours in airplane mode must not turn into hundreds of retries. While offline, the
	 * reconnect timer is not continued. The next connection is triggered by `online`.
	 */
	it("going offline drops the reconnect timer", async () => {
		const h = harness();
		h.wake.start();
		makeReady(h);

		h.stream.last.fail(new Error("network"));
		await flush();
		expect(h.timers.count()).toBe(1);

		h.online.value = false;
		h.controller.set({ state: "ready" });
		expect(h.timers.count()).toBe(0);

		h.timers.advance(600_000);
		await flush();
		expect(h.stream.count).toBe(1);

		h.online.value = true;
		h.controller.set({ state: "ready" });
		expect(h.stream.count).toBe(2);
	});

	/**
	 * If the stream throws a malformed frame, the app does not crash, and that value never reaches the
	 * coordinator.
	 */
	it("a malformed frame is a connection failure and wakes nothing", async () => {
		const h = harness();
		h.wake.start();
		makeReady(h);

		h.stream.last.fail(
			new RowCatApiError({
				status: 200,
				code: "invalid_stream_frame",
				message: "could not read the frame",
			}),
		);
		await flush();

		expect(h.autoSync.requests).toEqual([]);
		h.timers.advance(1_000);
		await flush();
		expect(h.stream.count).toBe(2);
	});
});

describe("account isolation", () => {
	/**
	 * **P0.** If Alice's stream could wake Bob's sync, the release must not ship. Two layers prevent
	 * it: `stop()` cuts the signal, and late-arriving events are dropped by the generation check.
	 */
	it("an event after `stop()` wakes nothing", async () => {
		const h = harness();
		h.wake.start();
		makeReady(h);
		const opening = h.stream.last;

		h.wake.stop();
		opening.emit(42);
		await flush();

		expect(h.autoSync.requests).toEqual([]);
		expect(opening.aborted).toBe(true);
	});

	it("an event after losing the scope wakes nothing", async () => {
		const h = harness();
		h.wake.start();
		makeReady(h);
		const opening = h.stream.last;

		// Logout or account withdrawal has already dropped the scope, but the stream has not closed yet.
		h.owned.value = false;
		opening.emit(7);
		await flush();

		expect(h.autoSync.requests).toEqual([]);
	});

	/**
	 * Even when the member id is the same (Alice, logout, Alice again), the old instance is not
	 * reused. A stopped instance that is started again opens a new stream, and the old stream stays
	 * dead.
	 */
	it("restarting a stopped instance leaves the old stream dead", async () => {
		const h = harness();
		h.wake.start();
		makeReady(h);
		const first = h.stream.last;

		h.wake.stop();
		h.wake.start();
		const second = h.stream.last;

		expect(second).not.toBe(first);
		expect(first.aborted).toBe(true);
		expect(second.aborted).toBe(false);

		first.emit(1);
		await flush();
		expect(h.autoSync.requests).toEqual([]);

		second.emit(1);
		await flush();
		expect(h.autoSync.requests).toEqual(["remote-wake"]);
	});

	it("`stop()` also clears the reconnect wait; no timer remains", async () => {
		const h = harness();
		h.wake.start();
		makeReady(h);
		h.stream.last.fail(new Error("network"));
		await flush();
		expect(h.timers.count()).toBe(1);

		h.wake.stop();
		expect(h.timers.count()).toBe(0);
		h.timers.advance(600_000);
		await flush();
		expect(h.stream.count).toBe(1);
	});

	it("attaching and detaching repeatedly leaves one live stream", async () => {
		const h = harness();
		for (let i = 0; i < 10; i++) {
			h.wake.start();
			makeReady(h);
			h.wake.stop();
			h.controller.set({ trusted: false });
		}
		expect(h.stream.count).toBe(10);
		expect(h.stream.openings.filter((o) => !o.aborted)).toHaveLength(0);
		expect(h.timers.count()).toBe(0);
	});
});
