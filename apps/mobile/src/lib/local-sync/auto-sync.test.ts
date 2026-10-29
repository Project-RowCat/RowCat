import type { SyncController, SyncRunResult, SyncSnapshot } from "@rowcat/sync";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AutoSyncPreferenceStore } from "../local-data/auto-sync-preference.ts";
import { createLocalMutationSignal } from "../local-data/mutation-signal.ts";
import {
	createMobileAutoSync,
	type MobileLifecycleSource,
	type MobileNetworkSource,
} from "./auto-sync.ts";

/**
 * Mobile auto-sync adapter: locks the **signal wiring** by value.
 *
 * The scheduling rules (debounce, single run, one follow-up, backoff) are covered by
 * `@rowcat/sync`'s tests and are not run again here. This file checks that this app's signals reach
 * the coordinator correctly: one foreground return is one request, intermediate states (`inactive`)
 * do not create duplicates, and the toggle turns off only automatic runs.
 */

const LIFECYCLE_MS = 200;
const DEBOUNCE_MS = 1_000;

function fakeController(options?: { snapshot?: Partial<SyncSnapshot> }): {
	controller: SyncController;
	runs: () => number;
	inspects: () => number;
} {
	let runs = 0;
	let inspects = 0;
	const snapshot: SyncSnapshot = {
		state: "ready",
		trusted: true,
		initialSyncDone: true,
		lastSyncedAt: null,
		lastError: null,
		...options?.snapshot,
	};
	const controller = {
		snapshot: () => snapshot,
		subscribe: () => () => {},
		inspect: async () => {
			inspects++;
		},
		setup: async () => null,
		unlock: async () => {},
		syncNow: async () => {
			runs++;
			return {} as SyncRunResult;
		},
		forgetDevice: async () => {},
		rotateRecoveryCode: async () => ({ recoveryCode: "" }),
		startPairing: async () => {
			throw new Error("not in this test");
		},
		approvePairing: async () => {},
	} as unknown as SyncController;
	return { controller, runs: () => runs, inspects: () => inspects };
}

function fakeLifecycle(initial = "active") {
	let state = initial;
	const listeners = new Set<(next: string) => void>();
	return {
		source: {
			current: () => state,
			subscribe(listener: (next: string) => void) {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
		} satisfies MobileLifecycleSource,
		emit(next: string) {
			state = next;
			for (const listener of listeners) listener(next);
		},
	};
}

function fakeNetwork(initial: boolean | null = true) {
	let state = initial;
	const listeners = new Set<(online: boolean) => void>();
	return {
		source: {
			current: () => state,
			subscribe(listener: (online: boolean) => void) {
				listeners.add(listener);
				return () => listeners.delete(listener);
			},
		} satisfies MobileNetworkSource,
		emit(online: boolean) {
			state = online;
			for (const listener of listeners) listener(online);
		},
	};
}

const preference = (enabled = true): AutoSyncPreferenceStore => {
	let value = enabled;
	return {
		isEnabled: async () => value,
		setEnabled: async (next) => {
			value = next;
		},
	};
};

function harness(options?: {
	enabled?: boolean;
	owns?: () => boolean;
	lifecycleInitial?: string;
	networkInitial?: boolean | null;
}) {
	const controller = fakeController();
	const lifecycle = fakeLifecycle(options?.lifecycleInitial);
	const network = fakeNetwork(options?.networkInitial);
	const mutations = createLocalMutationSignal();
	const adapter = createMobileAutoSync({
		controller: controller.controller,
		mutations,
		preference: preference(options?.enabled),
		ownsStore: options?.owns ?? (() => true),
		lifecycle: lifecycle.source,
		network: network.source,
	});
	return { ...controller, lifecycle, network, mutations, adapter };
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

/** Flushes the startup sequence (preference read → inspect) and all pending timers. */
const settle = async (ms: number): Promise<void> => {
	await vi.advanceTimersByTimeAsync(ms);
};

describe("start", () => {
	it("one start is one inspect + one startup sync", async () => {
		const h = harness();
		h.adapter.start();
		await settle(LIFECYCLE_MS + 10);
		expect(h.inspects()).toBe(1);
		expect(h.runs()).toBe(1);
	});

	it("start is idempotent — a double mount doesn't add requests", async () => {
		const h = harness();
		h.adapter.start();
		h.adapter.start();
		await settle(LIFECYCLE_MS + 10);
		expect(h.runs()).toBe(1);
	});
});

describe("local change", () => {
	it("consecutive writes fold into one run — debounce", async () => {
		const h = harness();
		h.adapter.start();
		await settle(LIFECYCLE_MS + 10);
		const before = h.runs();

		h.mutations.notify();
		await settle(300);
		h.mutations.notify();
		await settle(300);
		h.mutations.notify();
		await settle(DEBOUNCE_MS + 10);
		expect(h.runs()).toBe(before + 1);
	});
});

describe("returning to the foreground", () => {
	it("the background → active transition is one request", async () => {
		const h = harness();
		h.adapter.start();
		await settle(LIFECYCLE_MS + 10);
		const before = h.runs();

		h.lifecycle.emit("background");
		await settle(LIFECYCLE_MS + 10);
		expect(h.runs()).toBe(before);

		h.lifecycle.emit("active");
		await settle(LIFECYCLE_MS + 10);
		expect(h.runs()).toBe(before + 1);
	});

	/** iOS passes through `active → inactive → active` routinely, and that round trip is still one request. */
	it("an inactive in between creates no duplicate request", async () => {
		const h = harness();
		h.adapter.start();
		await settle(LIFECYCLE_MS + 10);
		const before = h.runs();

		h.lifecycle.emit("inactive");
		h.lifecycle.emit("background");
		await settle(LIFECYCLE_MS + 10);
		expect(h.runs()).toBe(before);

		h.lifecycle.emit("inactive");
		h.lifecycle.emit("active");
		await settle(LIFECYCLE_MS + 10);
		expect(h.runs()).toBe(before + 1);
	});
});

describe("reconnecting", () => {
	it("the offline → online transition is one request", async () => {
		const h = harness();
		h.adapter.start();
		await settle(LIFECYCLE_MS + 10);
		const before = h.runs();

		h.network.emit(false);
		await settle(LIFECYCLE_MS + 10);
		expect(h.runs()).toBe(before);

		h.network.emit(true);
		await settle(LIFECYCLE_MS + 10);
		expect(h.runs()).toBe(before + 1);
	});

	it("online → online (connection type change) creates no request", async () => {
		const h = harness();
		h.adapter.start();
		await settle(LIFECYCLE_MS + 10);
		const before = h.runs();

		h.network.emit(true);
		h.network.emit(true);
		await settle(LIFECYCLE_MS + 10);
		expect(h.runs()).toBe(before);
	});
});

describe("toggle", () => {
	it("when off, automatic triggers are ignored", async () => {
		const h = harness({ enabled: false });
		h.adapter.start();
		await settle(LIFECYCLE_MS + 10);
		expect(h.runs()).toBe(0);

		h.mutations.notify();
		h.lifecycle.emit("background");
		h.lifecycle.emit("active");
		await settle(DEBOUNCE_MS + LIFECYCLE_MS + 10);
		expect(h.runs()).toBe(0);
	});

	it("manual runs even when off — what's turned off is the schedule, not sync", async () => {
		const h = harness({ enabled: false });
		h.adapter.start();
		await settle(LIFECYCLE_MS + 10);

		const manual = h.adapter.runManualSync();
		await settle(LIFECYCLE_MS + 10);
		expect((await manual).status).toBe("ok");
		expect(h.runs()).toBe(1);
	});

	it("it runs once the moment it turns on — changes accumulated while off ride that run", async () => {
		const h = harness({ enabled: false });
		h.adapter.start();
		await settle(LIFECYCLE_MS + 10);

		const enabling = h.adapter.setEnabled(true);
		await settle(LIFECYCLE_MS + 10);
		await enabling;
		expect(h.runs()).toBe(1);
	});
});

describe("ownership and stopping", () => {
	it("an adapter that lost its scope creates no run", async () => {
		let owns = true;
		const h = harness({ owns: () => owns });
		h.adapter.start();
		await settle(LIFECYCLE_MS + 10);
		const before = h.runs();

		/** Account switch: scope ownership is gone (Alice → sign out → Bob/Alice). */
		owns = false;
		h.lifecycle.emit("background");
		h.lifecycle.emit("active");
		await settle(LIFECYCLE_MS + 10);
		expect(h.runs()).toBe(before);
	});

	it("after stop no signal creates a run", async () => {
		const h = harness();
		h.adapter.start();
		await settle(LIFECYCLE_MS + 10);
		const before = h.runs();

		h.adapter.stop();
		h.mutations.notify();
		h.lifecycle.emit("background");
		h.lifecycle.emit("active");
		h.network.emit(false);
		h.network.emit(true);
		await settle(DEBOUNCE_MS + LIFECYCLE_MS + 10);
		expect(h.runs()).toBe(before);
	});
});
