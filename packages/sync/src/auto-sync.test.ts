import { describe, expect, it } from "vitest";
import {
	type AutoSyncCoordinator,
	type AutoSyncTimers,
	classifyAutoSyncFailure,
	createAutoSyncCoordinator,
} from "./auto-sync.ts";

/**
 * Covers only the auto-sync schedule: no records, crypto, or server. The test owns the clock. Real
 * timers would make verifying a 1-second debounce take a real second, and they cannot reproduce
 * races such as a signal arriving while a run is in progress.
 */

function createFakeTimers() {
	let now = 0;
	let seq = 0;
	const scheduled = new Map<number, { at: number; handler: () => void }>();

	const timers: AutoSyncTimers = {
		setTimeout(handler, ms) {
			const id = ++seq;
			scheduled.set(id, { at: now + ms, handler });
			return id;
		},
		clearTimeout(handle) {
			scheduled.delete(handle as number);
		},
		now: () => now,
	};

	const advance = async (ms: number): Promise<void> => {
		const target = now + ms;
		for (;;) {
			const due = [...scheduled.entries()]
				.filter(([, entry]) => entry.at <= target)
				.sort((a, b) => a[1].at - b[1].at)[0];
			if (!due) break;
			scheduled.delete(due[0]);
			now = Math.max(now, due[1].at);
			due[1].handler();
			// Gives promise chains started by the timer callbacks a chance to settle.
			await flush();
		}
		now = target;
		await flush();
	};

	return { timers, advance, pending: () => scheduled.size, at: () => now };
}

const flush = async (): Promise<void> => {
	for (let i = 0; i < 20; i++) await Promise.resolve();
};

interface Harness {
	auto: AutoSyncCoordinator;
	advance: (ms: number) => Promise<void>;
	pending: () => number;
	runs: () => number;
	/**
	 * Highest number of runs in progress at once. A value above 1 means the single-run guarantee
	 * broke.
	 */
	peak: () => number;
	settleCurrent: (outcome?: "ok" | "skip" | Error) => Promise<void>;
	canRun: (value: boolean) => void;
	online: (value: boolean) => void;
}

/**
 * The run held by the test. `run()` does not finish immediately; it waits for `settleCurrent()`.
 * That keeps open the window in which a signal can arrive during a run.
 */
function harness(options: { autoSettle?: boolean } = {}): Harness {
	const { timers, advance, pending } = createFakeTimers();
	let runs = 0;
	let active = 0;
	let peak = 0;
	let allowed = true;
	let connected = true;
	let release: ((outcome: "ok" | "skip" | Error) => void) | null = null;

	const auto = createAutoSyncCoordinator({
		timers,
		target: {
			canRun: () => allowed,
			isOnline: () => connected,
			run: async () => {
				runs++;
				active++;
				peak = Math.max(peak, active);
				try {
					if (options.autoSettle !== false) return true;
					const outcome = await new Promise<"ok" | "skip" | Error>(
						(resolve) => {
							release = resolve;
						},
					);
					if (outcome instanceof Error) throw outcome;
					return outcome === "ok";
				} finally {
					active--;
				}
			},
		},
	});

	return {
		auto,
		advance,
		pending,
		runs: () => runs,
		peak: () => peak,
		async settleCurrent(outcome = "ok") {
			const resolve = release;
			release = null;
			resolve?.(outcome);
			await flush();
		},
		canRun: (value) => {
			allowed = value;
		},
		online: (value) => {
			connected = value;
		},
	};
}

describe("local change debounce", () => {
	it("one change runs **once** after a second", async () => {
		const h = harness();
		h.auto.notifyLocalChange();
		expect(h.auto.status().phase).toBe("scheduled");

		await h.advance(999);
		expect(h.runs()).toBe(0);
		await h.advance(1);
		expect(h.runs()).toBe(1);
		expect(h.auto.status().phase).toBe("idle");
	});

	it("twenty consecutive changes fold into **one** run", async () => {
		const h = harness();
		for (let i = 0; i < 20; i++) {
			h.auto.notifyLocalChange();
			await h.advance(100);
		}
		expect(h.runs()).toBe(0);
		await h.advance(1_000);
		expect(h.runs()).toBe(1);
	});

	it("the debounce is **trailing**: a second after the last change", async () => {
		const h = harness();
		h.auto.notifyLocalChange();
		await h.advance(800);
		h.auto.notifyLocalChange();
		await h.advance(800);
		expect(h.runs()).toBe(0);
		await h.advance(200);
		expect(h.runs()).toBe(1);
	});
});

describe("lifecycle signals", () => {
	it("visible, focus and online arriving together still make one run", async () => {
		const h = harness();
		h.auto.requestSync("visible");
		h.auto.requestSync("focus");
		h.auto.requestSync("online");
		await h.advance(1_000);
		expect(h.runs()).toBe(1);
	});

	it("a foreground signal **absorbs** a pending local debounce", async () => {
		const h = harness();
		h.auto.notifyLocalChange();
		await h.advance(100);
		h.auto.requestSync("focus");
		// The absorption window (200 ms) is earlier than the remaining debounce (900 ms), so the window
		// wins.
		await h.advance(200);
		expect(h.runs()).toBe(1);
		await h.advance(5_000);
		expect(h.runs()).toBe(1);
	});
});

describe("single run and one follow-up", () => {
	it("signals during a run fold into **one follow-up**", async () => {
		const h = harness({ autoSettle: false });
		h.auto.requestSync("startup");
		await h.advance(200);
		expect(h.runs()).toBe(1);

		for (let i = 0; i < 10; i++) h.auto.notifyLocalChange();
		h.auto.requestSync("focus");
		expect(h.runs()).toBe(1);

		await h.settleCurrent("ok");
		await h.advance(0);
		expect(h.runs()).toBe(2);

		await h.settleCurrent("ok");
		await h.advance(10_000);
		expect(h.runs()).toBe(2);
		expect(h.peak()).toBe(1);
	});

	it("no signal, no follow-up run", async () => {
		const h = harness({ autoSettle: false });
		h.auto.requestSync("startup");
		await h.advance(200);
		await h.settleCurrent("ok");
		await h.advance(10_000);
		expect(h.runs()).toBe(1);
	});

	it("concurrent runs **never exceed one**, even when automatic, manual and lifecycle overlap", async () => {
		const h = harness({ autoSettle: false });
		h.auto.notifyLocalChange();
		await h.advance(1_000);
		const manual = h.auto.runNow();
		h.auto.requestSync("focus");
		h.auto.notifyLocalChange();
		expect(h.peak()).toBe(1);

		await h.settleCurrent("ok");
		await h.advance(0);
		expect(h.peak()).toBe(1);
		await h.settleCurrent("ok");
		expect(await manual).toEqual({ status: "ok" });
		expect(h.peak()).toBe(1);
	});
});

describe("manual runs", () => {
	it("while running it does not refuse; it gives **the follow-up run's result**", async () => {
		const h = harness({ autoSettle: false });
		h.auto.requestSync("startup");
		await h.advance(200);
		const manual = h.auto.runNow();
		await h.settleCurrent("ok");
		await h.advance(0);
		expect(h.runs()).toBe(2);
		await h.settleCurrent("ok");
		expect(await manual).toEqual({ status: "ok" });
	});

	it("when it cannot run it resolves skipped rather than hanging", async () => {
		const h = harness();
		h.canRun(false);
		const manual = h.auto.runNow();
		await h.advance(10);
		expect(await manual).toEqual({ status: "skipped" });
	});
});

describe("backoff", () => {
	it("transient failures back off 5s → 15s → 30s → 60s", async () => {
		const h = harness({ autoSettle: false });
		const fail = Object.assign(new Error("network"), { status: 0 });

		h.auto.requestSync("startup");
		await h.advance(200);
		await h.settleCurrent(fail);
		expect(h.auto.status().phase).toBe("backoff");
		expect(h.auto.status().errorCategory).toBe("network");

		for (const delay of [5_000, 15_000, 30_000, 60_000]) {
			const before = h.runs();
			await h.advance(delay - 1);
			expect(h.runs()).toBe(before);
			await h.advance(1);
			expect(h.runs()).toBe(before + 1);
			await h.settleCurrent(fail);
		}
		await h.advance(60_000);
		expect(h.runs()).toBe(6);
	});

	it("success resets the backoff", async () => {
		const h = harness({ autoSettle: false });
		const fail = Object.assign(new Error("server"), { status: 503 });

		h.auto.requestSync("startup");
		await h.advance(200);
		await h.settleCurrent(fail);
		await h.advance(5_000);
		await h.settleCurrent("ok");
		expect(h.auto.status().errorCategory).toBeNull();

		h.auto.requestSync("focus");
		await h.advance(200);
		await h.settleCurrent(fail);
		// Back to the first delay.
		await h.advance(4_999);
		expect(h.runs()).toBe(3);
		await h.advance(1);
		expect(h.runs()).toBe(4);
	});

	it("local changes during backoff **do not bring the retry forward**", async () => {
		const h = harness({ autoSettle: false });
		h.auto.requestSync("startup");
		await h.advance(200);
		await h.settleCurrent(Object.assign(new Error("network"), { status: 0 }));

		h.auto.notifyLocalChange();
		await h.advance(1_500);
		expect(h.runs()).toBe(1);
		await h.advance(3_500);
		expect(h.runs()).toBe(2);
	});

	it("user and lifecycle signals break the backoff", async () => {
		const h = harness({ autoSettle: false });
		h.auto.requestSync("startup");
		await h.advance(200);
		await h.settleCurrent(Object.assign(new Error("network"), { status: 0 }));

		h.auto.requestSync("focus");
		await h.advance(200);
		expect(h.runs()).toBe(2);
	});

	it("failures retrying cannot fix **block** rather than back off", async () => {
		for (const failure of [
			{ status: 401 },
			{ status: 403 },
			{ code: "sync_locked", status: 0 },
			{ status: 400 },
		]) {
			const h = harness({ autoSettle: false });
			h.auto.requestSync("startup");
			await h.advance(200);
			await h.settleCurrent(Object.assign(new Error("permanent"), failure));
			expect(h.auto.status().phase).toBe("blocked");
			await h.advance(300_000);
			expect(h.runs()).toBe(1);
		}
	});
});

describe("offline", () => {
	it("offline it does not keep the timer going", async () => {
		const h = harness();
		h.online(false);
		h.auto.notifyLocalChange();
		await h.advance(1_000);
		expect(h.runs()).toBe(0);
		expect(h.auto.status().phase).toBe("offline");
		await h.advance(600_000);
		expect(h.runs()).toBe(0);
		expect(h.pending()).toBe(0);
	});

	it("`online` runs once right away", async () => {
		const h = harness();
		h.online(false);
		h.auto.notifyLocalChange();
		await h.advance(1_000);

		h.online(true);
		h.auto.requestSync("online");
		await h.advance(200);
		expect(h.runs()).toBe(1);
	});
});

describe("states that cannot run", () => {
	it("unconfigured, locked or off **uses no network**", async () => {
		const h = harness();
		h.canRun(false);
		h.auto.requestSync("startup");
		h.auto.notifyLocalChange();
		h.auto.requestSync("focus");
		await h.advance(600_000);
		expect(h.runs()).toBe(0);
		expect(h.auto.status().phase).toBe("blocked");
	});

	it("runs once unlocked", async () => {
		const h = harness();
		h.canRun(false);
		h.auto.requestSync("startup");
		await h.advance(1_000);
		expect(h.runs()).toBe(0);

		h.canRun(true);
		h.auto.requestSync("unlocked");
		await h.advance(200);
		expect(h.runs()).toBe(1);
	});
});

describe("stopping", () => {
	it("stopping before the debounce **never runs**", async () => {
		const h = harness();
		h.auto.notifyLocalChange();
		h.auto.stop();
		await h.advance(600_000);
		expect(h.runs()).toBe(0);
		expect(h.auto.status().phase).toBe("stopped");
		expect(h.pending()).toBe(0);
	});

	it("stopping during a run leaves no follow-up", async () => {
		const h = harness({ autoSettle: false });
		h.auto.requestSync("startup");
		await h.advance(200);
		h.auto.notifyLocalChange();
		h.auto.stop();
		await h.settleCurrent("ok");
		await h.advance(600_000);
		expect(h.runs()).toBe(1);
	});

	it("signals after stopping make nothing", async () => {
		const h = harness();
		h.auto.stop();
		h.auto.notifyLocalChange();
		h.auto.requestSync("focus");
		expect(await h.auto.runNow()).toEqual({ status: "skipped" });
		await h.advance(600_000);
		expect(h.runs()).toBe(0);
	});

	it("stopping after a failure removes the backoff timer too", async () => {
		const h = harness({ autoSettle: false });
		h.auto.requestSync("startup");
		await h.advance(200);
		await h.settleCurrent(Object.assign(new Error("network"), { status: 0 }));
		expect(h.pending()).toBe(1);
		h.auto.stop();
		expect(h.pending()).toBe(0);
		await h.advance(600_000);
		expect(h.runs()).toBe(1);
	});
});

describe("skipped runs", () => {
	it("not running because another tab holds the lock is not a failure", async () => {
		const h = harness({ autoSettle: false });
		h.auto.requestSync("startup");
		await h.advance(200);
		await h.settleCurrent("skip");
		expect(h.auto.status().phase).toBe("idle");
		expect(h.auto.status().errorCategory).toBeNull();
		expect(h.auto.status().lastSuccessAt).toBeNull();
		await h.advance(600_000);
		expect(h.runs()).toBe(1);
	});

	it("a sync of zero records is a success; the last success time rises", async () => {
		const h = harness();
		h.auto.requestSync("startup");
		await h.advance(200);
		expect(h.auto.status().lastSuccessAt).not.toBeNull();
	});
});

describe("failure classification", () => {
	it("reads status codes and codes from the same table", () => {
		expect(classifyAutoSyncFailure({ status: 0 })).toBe("network");
		expect(classifyAutoSyncFailure({ status: 503 })).toBe("server");
		expect(classifyAutoSyncFailure({ status: 429 })).toBe("server");
		expect(classifyAutoSyncFailure({ status: 401 })).toBe("unauthorized");
		expect(classifyAutoSyncFailure({ status: 403 })).toBe("unauthorized");
		expect(classifyAutoSyncFailure({ status: 400 })).toBe("invalid_payload");
		expect(classifyAutoSyncFailure({ status: 0, code: "sync_locked" })).toBe(
			"crypto",
		);
		expect(
			classifyAutoSyncFailure({
				status: 403,
				code: "sync_keyring_proof_invalid",
			}),
		).toBe("crypto");
	});
});
