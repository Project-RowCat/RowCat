import type { ChatSeed } from "@rowcat/chat";
import { CHAT_SEED_VERSION } from "@rowcat/contracts";
import type { SyncController, SyncSnapshot } from "@rowcat/sync";
import { createAutoSyncCoordinator } from "@rowcat/sync";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createDevice,
	type Device,
	FakeSyncServer,
	TEST_DEK,
} from "#/test/sync-devices.ts";
import { createWebAutoSync } from "./auto-sync.ts";

/**
 * Auto-sync against the real store. The coordinator rules (debounce, single run, one follow-up,
 * backoff) are tested in packages/sync/src/auto-sync.test.ts. This file checks the wiring:
 * - a local write emits a signal
 * - a remote apply does NOT emit a signal (the most costly case in this slice)
 * - a write made during a run is included in the single follow-up run
 * - an account switch does not run the remaining schedule under the other account
 *
 * The store comes from the product's own assembly (local-data/stores.ts), not a harness build. A
 * wrapped store would verify nothing, so the signal producer is not imitated.
 */

const seed = (title: string): ChatSeed => ({
	version: CHAT_SEED_VERSION,
	storyId: "story-1",
	title,
	tagline: "",
	adult: false,
	promptProtected: false,
	scenario: "Scenario",
	firstScene: "",
	playGuide: "",
	persona: null,
	characters: [],
	lore: [],
	startScenes: [],
	sceneImages: [],
});

const flush = async (): Promise<void> => {
	for (let i = 0; i < 20; i++) await Promise.resolve();
};

/** Yields to the event loop so that scheduled (debounced) runs have a chance to fire. */
const tick = async (rounds: number): Promise<void> => {
	for (let i = 0; i < rounds; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		await flush();
	}
};

/**
 * Waits until a condition holds, instead of using fixed sleeps. Startup begins with an IndexedDB
 * read, so a fixed delay only suffices on an idle machine. Under a parallel suite, a late start is
 * not a code failure. This helper does not check that something ran exactly once. Callers assert
 * the exact count after the condition holds, following a short extra wait.
 */
const waitUntil = async (
	ready: () => boolean,
	timeoutMs = 2_000,
): Promise<void> => {
	const deadline = Date.now() + timeoutMs;
	while (!ready() && Date.now() < deadline)
		await new Promise((resolve) => setTimeout(resolve, 5));
};

/** Coordinators created by this file. All of them must be stopped before the database is closed. */
let wired: Array<{ stop: () => void }> = [];
let devices: Device[] = [];
const spawn = (
	name: string,
	server: FakeSyncServer,
	ownsStore?: () => boolean,
): Device => {
	const device = createDevice(name, server, ownsStore ? { ownsStore } : {});
	devices.push(device);
	return device;
};
afterEach(() => {
	/*
	 * Order matters. A leftover debounce timer that wakes against a closed connection becomes an
	 * unhandled rejection outside the test, which fails the next test.
	 */
	for (const entry of wired) entry.stop();
	wired = [];
	for (const device of devices) device.close();
	devices = [];
});

/**
 * Wires one device to auto-sync with a debounce of 0. Timing is already covered by the pure tests.
 * Waiting a real second here would only slow the file, and slow tests eventually get skipped.
 */
function attach(device: Device, options: { ownsStore?: () => boolean } = {}) {
	let runs = 0;
	let active = 0;
	let peak = 0;
	const auto = createAutoSyncCoordinator({
		localDebounceMs: 0,
		lifecycleWindowMs: 0,
		target: {
			canRun: () => options.ownsStore?.() ?? true,
			run: async () => {
				runs++;
				active++;
				peak = Math.max(peak, active);
				try {
					await device.engine.run(TEST_DEK);
					return true;
				} finally {
					active--;
				}
			},
		},
	});
	// Same wiring as the product: each mutation signal wakes one coordinator.
	const unsubscribe = device.mutations.subscribe(() =>
		auto.notifyLocalChange(),
	);
	wired.push({
		stop: () => {
			unsubscribe();
			auto.stop();
		},
	});
	return {
		auto,
		unsubscribe,
		runs: () => runs,
		peak: () => peak,
		settle: () => tick(40),
	};
}

describe("local changes wake sync", () => {
	it("every chat write path emits a signal", async () => {
		const device = spawn("a", new FakeSyncServer());
		let signals = 0;
		device.mutations.subscribe(() => {
			signals++;
		});

		const room = await device.chat.createRoom({
			originStoryId: null,
			seed: seed("Room"),
			title: "Room",
		});
		expect(signals).toBe(1);

		await device.chat.appendMessage({
			roomId: room.id,
			role: "user",
			content: "hello",
		});
		expect(signals).toBe(2);

		await device.chat.renameRoom(room.id, "New name");
		expect(signals).toBe(3);

		await device.chat.deleteRoom(room.id);
		expect(signals).toBe(4);
	});

	it("every authoring write path emits a signal", async () => {
		const device = spawn("a", new FakeSyncServer());
		let signals = 0;
		device.mutations.subscribe(() => {
			signals++;
		});

		const draft = await device.authoring.createDraft();
		expect(signals).toBe(1);

		await device.authoring.updateDraft(draft.id, { title: "Title" });
		expect(signals).toBe(2);

		await device.authoring.createLore(draft.id, { content: "Setting" });
		expect(signals).toBe(3);

		await device.authoring.deleteDraft(draft.id);
		expect(signals).toBe(4);
	});

	it("**reads emit no signal**", async () => {
		const device = spawn("a", new FakeSyncServer());
		const room = await device.chat.createRoom({
			originStoryId: null,
			seed: seed("Room"),
			title: "Room",
		});
		let signals = 0;
		device.mutations.subscribe(() => {
			signals++;
		});

		await device.chat.listRooms();
		await device.chat.getRoom(room.id);
		await device.chat.listRecentMessages(room.id);
		await device.authoring.listDrafts();
		expect(signals).toBe(0);
	});

	it("committed changes really reach the server", async () => {
		const server = new FakeSyncServer();
		const device = spawn("a", server);
		const wired = attach(device);

		const room = await device.chat.createRoom({
			originStoryId: null,
			seed: seed("Room"),
			title: "Room",
		});
		await wired.settle();

		expect(wired.runs()).toBe(1);
		expect(server.row(room.id)).toBeDefined();
	});

	it("consecutive writes fold into one run", async () => {
		const server = new FakeSyncServer();
		const device = spawn("a", server);
		const wired = attach(device);

		const room = await device.chat.createRoom({
			originStoryId: null,
			seed: seed("Room"),
			title: "Room",
		});
		for (let i = 0; i < 5; i++)
			await device.chat.appendMessage({
				roomId: room.id,
				role: "user",
				content: `${i}`,
			});
		await wired.settle();

		// Runs are far fewer than the six signals, and all six changes still reach the server.
		expect(wired.runs()).toBeLessThanOrEqual(2);
		expect(server.size).toBe(6);
	});
});

describe("remote application makes no feedback", () => {
	/**
	 * The most valuable test in this slice. applyPull writes to the same IndexedDB. If that write
	 * counted as a local change, the result would be an endless pull, signal, pull loop. The visible
	 * symptom is that sync never stops, which users experience only as battery and data use.
	 */
	it("records applied by pull emit no local signal", async () => {
		const server = new FakeSyncServer();
		const a = spawn("a", server);
		const b = spawn("b", server);

		const room = await a.chat.createRoom({
			originStoryId: null,
			seed: seed("A's room"),
			title: "A's room",
		});
		await a.chat.appendMessage({
			roomId: room.id,
			role: "user",
			content: "hello",
		});
		await a.engine.run(TEST_DEK);

		let signals = 0;
		b.mutations.subscribe(() => {
			signals++;
		});
		const wired = attach(b);
		await b.engine.run(TEST_DEK);
		await wired.settle();

		// The record was received and is stored locally, but applying it is not a local change.
		expect(await b.chat.getRoom(room.id)).not.toBeNull();
		expect(signals).toBe(0);
		expect(wired.runs()).toBe(0);
	});

	it("the tombstone cascade emits no signal either", async () => {
		const server = new FakeSyncServer();
		const a = spawn("a", server);
		const b = spawn("b", server);

		const room = await a.chat.createRoom({
			originStoryId: null,
			seed: seed("Room"),
			title: "Room",
		});
		await a.chat.appendMessage({ roomId: room.id, role: "user", content: "1" });
		await a.engine.run(TEST_DEK);
		await b.engine.run(TEST_DEK);

		await a.chat.deleteRoom(room.id);
		await a.engine.run(TEST_DEK);

		let signals = 0;
		b.mutations.subscribe(() => {
			signals++;
		});
		await b.engine.run(TEST_DEK);
		expect(await b.chat.getRoom(room.id)).toBeNull();
		expect(signals).toBe(0);
	});
});

describe("changes during a run", () => {
	it("writes during a push ride **one follow-up run**", async () => {
		const server = new FakeSyncServer();
		const device = spawn("a", server);
		const wired = attach(device);

		const room = await device.chat.createRoom({
			originStoryId: null,
			seed: seed("Room"),
			title: "Room",
		});
		/*
		 * Renames the same room in the window after the server has received a push but before the client
		 * knows about it. That edit's revision is newer than the one collected, and `commitPush` does not
		 * clear dirty.
		 */
		server.duringPush = async () => {
			await device.chat.renameRoom(room.id, "Name changed during a run");
		};
		await wired.settle();

		expect(wired.runs()).toBeGreaterThanOrEqual(2);
		expect(wired.peak()).toBe(1);
		// The last round is on the server, and no dirty flag remains locally.
		const stored = await device.db.rooms.get(room.id);
		expect(stored?.title).toBe("Name changed during a run");
		expect(stored?.dirty).toBe(0);
	});

	it("a deletion during a run becomes a tombstone in the next run", async () => {
		const server = new FakeSyncServer();
		const device = spawn("a", server);
		const wired = attach(device);

		const room = await device.chat.createRoom({
			originStoryId: null,
			seed: seed("Room"),
			title: "Room",
		});
		server.duringPush = async () => {
			await device.chat.deleteRoom(room.id);
		};
		await wired.settle();

		expect(server.row(room.id)?.deleted).toBe(true);
		expect((await device.db.rooms.get(room.id))?.dirty).toBe(0);
	});

	it("manual, automatic and lifecycle signals overlapping still run one at a time", async () => {
		const server = new FakeSyncServer();
		const device = spawn("a", server);
		const wired = attach(device);

		await device.chat.createRoom({
			originStoryId: null,
			seed: seed("Room"),
			title: "Room",
		});
		const manual = wired.auto.runNow();
		wired.auto.requestSync("focus");
		wired.auto.notifyLocalChange();
		await wired.settle();

		expect(await manual).toEqual({ status: "ok" });
		expect(wired.peak()).toBe(1);
	});
});

describe("two devices", () => {
	/**
	 * V1 promise: A's changes upload automatically from A, and B receives them when it is reopened or
	 * brought to the foreground. The delay can be minutes rather than seconds. Shortening it belongs
	 * to the next slice (waking the server). Do not fill the gap with polling here.
	 */
	it("A's local edit uploads automatically and B's start signal receives it", async () => {
		const server = new FakeSyncServer();
		const a = spawn("a", server);
		const b = spawn("b", server);
		const wiredA = attach(a);
		const wiredB = attach(b);

		const room = await a.chat.createRoom({
			originStoryId: null,
			seed: seed("A's room"),
			title: "A's room",
		});
		await a.chat.appendMessage({
			roomId: room.id,
			role: "user",
			content: "hello",
		});
		// A does not press any sync button. The write alone uploads it.
		await wiredA.settle();
		expect(server.row(room.id)).toBeDefined();

		expect(await b.chat.getRoom(room.id)).toBeNull();
		wiredB.auto.requestSync("startup");
		await wiredB.settle();

		expect((await b.chat.getRoom(room.id))?.title).toBe("A's room");
		expect(await b.chat.listRecentMessages(room.id)).toHaveLength(1);
	});

	it("renames follow the same path; one foreground signal is enough", async () => {
		const server = new FakeSyncServer();
		const a = spawn("a", server);
		const b = spawn("b", server);
		const wiredA = attach(a);
		const wiredB = attach(b);

		const room = await a.chat.createRoom({
			originStoryId: null,
			seed: seed("First name"),
			title: "First name",
		});
		await wiredA.settle();
		wiredB.auto.requestSync("startup");
		await wiredB.settle();

		await a.chat.renameRoom(room.id, "Changed name");
		await wiredA.settle();

		wiredB.auto.requestSync("visible");
		await wiredB.settle();
		expect((await b.chat.getRoom(room.id))?.title).toBe("Changed name");
	});

	it("edits piled up offline all go out on one reconnect signal", async () => {
		const server = new FakeSyncServer();
		const a = spawn("a", server);
		const b = spawn("b", server);
		let online = false;
		let runs = 0;
		const auto = createAutoSyncCoordinator({
			localDebounceMs: 0,
			lifecycleWindowMs: 0,
			target: {
				canRun: () => true,
				isOnline: () => online,
				run: async () => {
					runs++;
					await a.engine.run(TEST_DEK);
					return true;
				},
			},
		});
		const unsubscribe = a.mutations.subscribe(() => auto.notifyLocalChange());
		wired.push({
			stop: () => {
				unsubscribe();
				auto.stop();
			},
		});

		const room = await a.chat.createRoom({
			originStoryId: null,
			seed: seed("Room made on a plane"),
			title: "Room made on a plane",
		});
		await a.chat.appendMessage({
			roomId: room.id,
			role: "user",
			content: "Offline",
		});
		const draft = await a.authoring.createDraft();
		await a.authoring.updateDraft(draft.id, { title: "Offline draft" });
		await tick(20);

		/*
		 * While offline, no requests went out (timers are not continued), yet all local work succeeded.
		 * Nothing in the sync path can block an edit.
		 */
		expect(runs).toBe(0);
		expect(server.size).toBe(0);
		expect(await a.chat.getRoom(room.id)).not.toBeNull();

		online = true;
		auto.requestSync("online");
		await tick(40);

		expect(server.row(room.id)).toBeDefined();
		expect(server.row(draft.id)).toBeDefined();

		await b.engine.run(TEST_DEK);
		expect((await b.chat.getRoom(room.id))?.title).toBe("Room made on a plane");
		expect((await b.authoring.getDraft(draft.id))?.title).toBe("Offline draft");
	});
});

describe("account isolation", () => {
	/**
	 * P0. If a leftover schedule runs under the next member's scope, the cursor and key it uses belong
	 * to the previous member.
	 */
	it("after ownership moves it **never runs**", async () => {
		const server = new FakeSyncServer();
		let owned = true;
		const device = spawn("a", server, () => owned);
		const wired = attach(device, { ownsStore: () => owned });

		await device.chat.createRoom({
			originStoryId: null,
			seed: seed("Room"),
			title: "Room",
		});
		// The account changes before the debounce expires.
		owned = false;
		await wired.settle();

		expect(wired.runs()).toBe(0);
		expect(server.size).toBe(0);
		expect(wired.auto.status().phase).toBe("blocked");
	});

	/**
	 * Withdrawal cannot be undone. If a leftover schedule revived the database under the deleted name,
	 * the user would be told their data was erased while a device still held their conversations.
	 */
	it("a leftover schedule after account deletion does not revive the database", async () => {
		const server = new FakeSyncServer();
		let owned = true;
		const device = spawn("a", server, () => owned);
		const wired = attach(device, { ownsStore: () => owned });

		await device.chat.createRoom({
			originStoryId: null,
			seed: seed("Room to be deleted"),
			title: "Room to be deleted",
		});

		/*
		 * Same order as the withdrawal procedure: drop the scope first (synchronously), then delete. If
		 * the order were reversed, a run in between would write to the connection being deleted.
		 */
		owned = false;
		const name = device.db.name;
		await device.db.delete({ disableAutoOpen: true });
		await wired.settle();

		expect(wired.runs()).toBe(0);
		expect(server.size).toBe(0);
		const names = (await indexedDB.databases()).map((entry) => entry.name);
		expect(names).not.toContain(name);
	});

	it("a stopped coordinator reacts to no later write", async () => {
		const server = new FakeSyncServer();
		const device = spawn("a", server);
		const wired = attach(device);

		wired.auto.stop();
		await device.chat.createRoom({
			originStoryId: null,
			seed: seed("Room"),
			title: "Room",
		});
		await wired.settle();

		expect(wired.runs()).toBe(0);
		expect(server.size).toBe(0);
	});
});

/**
 * Stubs only the browser signals. Storage and the engine are already covered by the tests above.
 */
function stubDom() {
	const documentListeners = new Map<string, Set<() => void>>();
	const windowListeners = new Map<string, Set<() => void>>();
	const bind = (map: Map<string, Set<() => void>>) => ({
		addEventListener: (type: string, listener: () => void) => {
			const bucket = map.get(type) ?? new Set();
			bucket.add(listener);
			map.set(type, bucket);
		},
		removeEventListener: (type: string, listener: () => void) => {
			map.get(type)?.delete(listener);
		},
	});
	const globals = globalThis as unknown as Record<string, unknown>;
	const previous = { document: globals.document, window: globals.window };
	globals.document = { visibilityState: "visible", ...bind(documentListeners) };
	globals.window = bind(windowListeners);

	return {
		documentListeners,
		windowListeners,
		count: () =>
			[...documentListeners.values(), ...windowListeners.values()].reduce(
				(total, bucket) => total + bucket.size,
				0,
			),
		emit: (map: Map<string, Set<() => void>>, type: string) => {
			for (const listener of [...(map.get(type) ?? [])]) listener();
		},
		restore: () => {
			globals.document = previous.document;
			globals.window = previous.window;
		},
	};
}

/** Stubs only the controller surface, since the adapter sees just three members of it. */
function stubController(state: SyncSnapshot["state"], trusted: boolean) {
	let snapshot: SyncSnapshot = {
		state,
		trusted,
		initialSyncDone: true,
		lastSyncedAt: null,
		lastError: null,
	};
	const inspect = vi.fn(async () => undefined);
	const syncNow = vi.fn(async () => null);
	const controller = {
		snapshot: () => snapshot,
		subscribe: () => () => undefined,
		inspect,
		syncNow,
		setup: async () => null,
		unlock: async () => undefined,
		forgetDevice: async () => undefined,
		rotateRecoveryCode: async () => ({ recoveryCode: "" }),
	} as unknown as SyncController;
	return {
		controller,
		inspect,
		syncNow,
		become: (next: Partial<SyncSnapshot>) => {
			snapshot = { ...snapshot, ...next };
		},
	};
}

describe("web adapter", () => {
	let dom: ReturnType<typeof stubDom> | null = null;
	afterEach(() => {
		dom?.restore();
		dom = null;
	});

	const build = (
		device: Device,
		controller: SyncController,
		ownsStore: () => boolean = () => true,
	) =>
		createWebAutoSync({
			controller,
			viewerId: "0123456789abcdef0123456789abcdef",
			mutations: device.mutations,
			preference: device.autoSyncPreference,
			ownsStore,
			// Timing values are checked by the pure tests. This file checks only the wiring.
			timing: { localDebounceMs: 5, lifecycleWindowMs: 5 },
		});

	it("on start it checks server state **once** and runs once", async () => {
		dom = stubDom();
		const device = spawn("a", new FakeSyncServer());
		const stub = stubController("ready", true);
		const auto = build(device, stub.controller);

		auto.start();
		await waitUntil(() => stub.syncNow.mock.calls.length > 0);
		// Also checks that it does not run again after startup.
		await new Promise((resolve) => setTimeout(resolve, 40));

		expect(stub.inspect).toHaveBeenCalledTimes(1);
		expect(stub.syncNow).toHaveBeenCalledTimes(1);
		auto.stop();
	});

	it("unconfigured or locked, it **uses no network**", async () => {
		for (const state of ["disabled", "locked"] as const) {
			dom = stubDom();
			const device = spawn(`a-${state}`, new FakeSyncServer());
			const stub = stubController(state, false);
			const auto = build(device, stub.controller);

			auto.start();
			await new Promise((resolve) => setTimeout(resolve, 40));
			dom.emit(dom.windowListeners, "focus");
			await device.chat.createRoom({
				originStoryId: null,
				seed: seed("Room"),
				title: "Room",
			});
			await new Promise((resolve) => setTimeout(resolve, 40));

			expect(stub.syncNow).not.toHaveBeenCalled();
			auto.stop();
			dom.restore();
			dom = null;
		}
	});

	it("`start → stop → start` does not add listeners", async () => {
		dom = stubDom();
		const device = spawn("a", new FakeSyncServer());
		const stub = stubController("ready", true);
		const auto = build(device, stub.controller);

		auto.start();
		const attached = dom.count();
		expect(attached).toBeGreaterThan(0);
		auto.start();
		expect(dom.count()).toBe(attached);

		auto.stop();
		expect(dom.count()).toBe(0);
		auto.start();
		expect(dom.count()).toBe(attached);
		auto.stop();
		expect(dom.count()).toBe(0);
	});

	it("once stopped, neither browser signals nor local writes do anything", async () => {
		dom = stubDom();
		const device = spawn("a", new FakeSyncServer());
		const stub = stubController("ready", true);
		const auto = build(device, stub.controller);

		auto.start();
		await new Promise((resolve) => setTimeout(resolve, 40));
		stub.syncNow.mockClear();
		auto.stop();

		dom.emit(dom.windowListeners, "focus");
		dom.emit(dom.windowListeners, "online");
		dom.emit(dom.documentListeners, "visibilitychange");
		await device.chat.createRoom({
			originStoryId: null,
			seed: seed("Room"),
			title: "Room",
		});
		await new Promise((resolve) => setTimeout(resolve, 40));
		expect(stub.syncNow).not.toHaveBeenCalled();
	});

	it("turning the toggle off stops automatic triggers and **manual still runs**", async () => {
		dom = stubDom();
		const device = spawn("a", new FakeSyncServer());
		const stub = stubController("ready", true);
		const auto = build(device, stub.controller);

		auto.start();
		/**
		 * Wait for the startup run itself, not a fixed 40ms: under load it landed after `mockClear()` and
		 * read as an automatic trigger with the toggle off.
		 */
		await vi.waitFor(() => expect(stub.syncNow).toHaveBeenCalled());
		await auto.setEnabled(false);
		stub.syncNow.mockClear();

		dom.emit(dom.windowListeners, "focus");
		await device.chat.createRoom({
			originStoryId: null,
			seed: seed("Room"),
			title: "Room",
		});
		await new Promise((resolve) => setTimeout(resolve, 40));
		expect(stub.syncNow).not.toHaveBeenCalled();
		expect(auto.snapshot().enabled).toBe(false);

		// What was disabled is the schedule, not sync itself. Manual sync still runs.
		await auto.runManualSync();
		expect(stub.syncNow).toHaveBeenCalledTimes(1);
		auto.stop();
	});

	it("the toggle stays on this device, and turning it back on runs once right away", async () => {
		dom = stubDom();
		const device = spawn("a", new FakeSyncServer());
		const stub = stubController("ready", true);
		const auto = build(device, stub.controller);

		auto.start();
		/** The startup run, waited for itself (see the test above). */
		await vi.waitFor(() => expect(stub.syncNow).toHaveBeenCalled());
		await auto.setEnabled(false);
		expect(await device.autoSyncPreference.isEnabled()).toBe(false);

		stub.syncNow.mockClear();
		await auto.setEnabled(true);
		await new Promise((resolve) => setTimeout(resolve, 40));
		expect(stub.syncNow).toHaveBeenCalledTimes(1);
		expect(await device.autoSyncPreference.isEnabled()).toBe(true);
		auto.stop();
	});

	it("starting while off skips the start sync too", async () => {
		dom = stubDom();
		const device = spawn("a", new FakeSyncServer());
		await device.autoSyncPreference.setEnabled(false);
		const stub = stubController("ready", true);
		const auto = build(device, stub.controller);

		auto.start();
		await new Promise((resolve) => setTimeout(resolve, 40));
		// Status is still read, because the screen must show whether the device is locked. No records are
		// exchanged.
		expect(stub.inspect).toHaveBeenCalledTimes(1);
		expect(stub.syncNow).not.toHaveBeenCalled();
		auto.stop();
	});

	it("if ownership moved, the start procedure ends midway", async () => {
		dom = stubDom();
		const device = spawn("a", new FakeSyncServer());
		const stub = stubController("ready", true);
		let owned = true;
		const auto = build(device, stub.controller, () => owned);

		owned = false;
		auto.start();
		await new Promise((resolve) => setTimeout(resolve, 40));
		expect(stub.syncNow).not.toHaveBeenCalled();
		auto.stop();
	});
});
