import type { ChatSeed } from "@rowcat/chat";
import { CHAT_SEED_VERSION, type SyncWakeEvent } from "@rowcat/contracts";
import type {
	AutoSyncCoordinator,
	SyncController,
	SyncSnapshot,
} from "@rowcat/sync";
import { createAutoSyncCoordinator } from "@rowcat/sync";
import { afterEach, describe, expect, it } from "vitest";
import {
	createDevice,
	type Device,
	FakeSyncServer,
	TEST_DEK,
} from "#/test/sync-devices.ts";
import type { AutoSyncSnapshot, WebAutoSync } from "./auto-sync.ts";
import type { SyncWakeStream } from "./transport.ts";
import { createWebSyncWake } from "./wake.ts";

/**
 * Two-device end-to-end test. Device B does nothing. The product claim: when A renames a room, B's
 * data follows without B returning to the foreground or pressing `Sync now`.
 *
 * The key assertion counts the reasons B's coordinator ran. If startup, visible, focus, or manual
 * appears, the test exercises the existing safety nets instead of wake, and a pass proves nothing.
 *
 * The server rule (notify only after commit) is a SQL property, checked against real Postgres in
 * apps/api/src/routes/me/sync.test.ts. The fake server's publish hook assumes it. This file
 * verifies the chain after it: server cursor advances → SSE frame → wake adapter →
 * requestSync("remote-wake") → coordinator → engine → pull → IndexedDB
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

const tick = async (rounds: number): Promise<void> => {
	for (let i = 0; i < rounds; i++) {
		await new Promise((resolve) => setTimeout(resolve, 0));
		for (let j = 0; j < 20; j++) await Promise.resolve();
	}
};

class TestBroker {
	private listeners = new Set<(cursor: number) => void>();
	subscribe(listener: (cursor: number) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}
	publish(cursor: number): void {
		for (const listener of [...this.listeners]) listener(cursor);
	}
}

/** Broker-to-SSE stream. Emits the same shape the real adapter receives from the SDK. */
const streamFrom = (
	broker: TestBroker,
	initial: () => number,
): SyncWakeStream =>
	async function* (signal) {
		const queue: number[] = [initial()];
		let resume: (() => void) | null = null;
		const wake = (): void => {
			const pending = resume;
			resume = null;
			pending?.();
		};
		const release = broker.subscribe((cursor) => {
			queue.push(cursor);
			wake();
		});
		signal.addEventListener("abort", wake);
		try {
			for (;;) {
				while (queue.length > 0) {
					if (signal.aborted) return;
					yield { cursor: queue.shift() as number } satisfies SyncWakeEvent;
				}
				if (signal.aborted) return;
				await new Promise<void>((resolve) => {
					resume = resolve;
				});
			}
		} finally {
			release();
		}
	};

const readyController = (): SyncController =>
	({
		snapshot: (): SyncSnapshot => ({
			state: "ready",
			trusted: true,
			initialSyncDone: true,
			lastSyncedAt: null,
			lastError: null,
		}),
		subscribe: () => () => undefined,
	}) as unknown as SyncController;

/** Wraps the pure coordinator in the WebAutoSync shape, the same seam the product uses. */
function autoPortOf(coordinator: AutoSyncCoordinator, reasons: string[]) {
	return {
		snapshot: (): AutoSyncSnapshot => ({
			...coordinator.status(),
			enabled: true,
		}),
		subscribe: coordinator.subscribe,
		requestSync: (reason: string) => {
			reasons.push(reason);
			coordinator.requestSync(reason as never);
		},
	} as unknown as WebAutoSync;
}

let devices: Device[] = [];
let cleanups: Array<() => void> = [];
afterEach(() => {
	for (const stop of cleanups) stop();
	cleanups = [];
	for (const device of devices) device.close();
	devices = [];
});

const spawn = (name: string, server: FakeSyncServer): Device => {
	const device = createDevice(name, server);
	devices.push(device);
	return device;
};

/** Device A: writes upload through auto sync alone. Wake is deliberately not attached. */
function author(device: Device, server: FakeSyncServer, broker: TestBroker) {
	const coordinator = createAutoSyncCoordinator({
		localDebounceMs: 0,
		lifecycleWindowMs: 0,
		target: {
			canRun: () => true,
			run: async () => {
				const before = server.cursor();
				await device.engine.run(TEST_DEK);
				/**
				 * Signals only when the server actually advanced, matching the real server's post-commit
				 * boundary. A run that only pulled must not signal, or two devices would wake each other.
				 */
				const after = server.cursor();
				if (after > before) broker.publish(after);
				return true;
			},
		},
	});
	const unsubscribe = device.mutations.subscribe(() =>
		coordinator.notifyLocalChange(),
	);
	cleanups.push(() => {
		unsubscribe();
		coordinator.stop();
	});
	return { settle: () => tick(40) };
}

/** Device B: stays open quietly, with no foreground-return trigger and no manual button. */
function listener(device: Device, broker: TestBroker) {
	const reasons: string[] = [];
	let runs = 0;
	const coordinator = createAutoSyncCoordinator({
		localDebounceMs: 0,
		lifecycleWindowMs: 0,
		target: {
			canRun: () => true,
			run: async () => {
				runs += 1;
				await device.engine.run(TEST_DEK);
				return true;
			},
		},
	});
	const wake = createWebSyncWake({
		controller: readyController(),
		autoSync: autoPortOf(coordinator, reasons),
		open: streamFrom(broker, () => 0),
		readLocalCursor: async () => (await device.sync.readState()).cursor,
		ownsStore: () => true,
		isOnline: () => true,
	});
	wake.start();
	cleanups.push(() => {
		wake.stop();
		coordinator.stop();
	});
	return { reasons, runs: () => runs, settle: () => tick(40), wake };
}

describe("converges by wake; B never returns to the foreground", () => {
	/** Spec §124. Creating a room reaches device B. B's only action is leaving the app open. */
	it("a room A made shows up on B", async () => {
		const server = new FakeSyncServer();
		const broker = new TestBroker();
		const a = spawn("a", server);
		const b = spawn("b", server);
		const wroteA = author(a, server, broker);
		const listensB = listener(b, broker);
		await listensB.settle();

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
		await wroteA.settle();
		await listensB.settle();

		expect((await b.chat.getRoom(room.id))?.title).toBe("A's room");
		expect(await b.chat.listRecentMessages(room.id)).toHaveLength(1);
		// This assertion is the point of the file: no trigger other than wake fired.
		expect(new Set(listensB.reasons)).toEqual(new Set(["remote-wake"]));
	});

	/**
	 * Spec §124. Renaming a room is the scenario the original request singled out as the product test.
	 */
	it("A's rename follows to B", async () => {
		const server = new FakeSyncServer();
		const broker = new TestBroker();
		const a = spawn("a", server);
		const b = spawn("b", server);
		const wroteA = author(a, server, broker);
		const listensB = listener(b, broker);

		const room = await a.chat.createRoom({
			originStoryId: null,
			seed: seed("First name"),
			title: "First name",
		});
		await wroteA.settle();
		await listensB.settle();
		expect((await b.chat.getRoom(room.id))?.title).toBe("First name");

		await a.chat.renameRoom(room.id, "Changed name");
		await wroteA.settle();
		await listensB.settle();

		expect((await b.chat.getRoom(room.id))?.title).toBe("Changed name");
		expect(new Set(listensB.reasons)).toEqual(new Set(["remote-wake"]));
	});

	/**
	 * Spec §126. Deletion takes the same path: the tombstone travels over and the room disappears on
	 * B.
	 */
	it("a room A deleted disappears on B too", async () => {
		const server = new FakeSyncServer();
		const broker = new TestBroker();
		const a = spawn("a", server);
		const b = spawn("b", server);
		const wroteA = author(a, server, broker);
		const listensB = listener(b, broker);

		const room = await a.chat.createRoom({
			originStoryId: null,
			seed: seed("Room to delete"),
			title: "Room to delete",
		});
		await wroteA.settle();
		await listensB.settle();
		expect(await b.chat.getRoom(room.id)).not.toBeNull();

		await a.chat.deleteRoom(room.id);
		await wroteA.settle();
		await listensB.settle();

		expect(await b.chat.getRoom(room.id)).toBeNull();
		expect(new Set(listensB.reasons)).toEqual(new Set(["remote-wake"]));
	});

	/** Spec §125. Drafts follow the same path. Wake contains no draft-specific code. */
	it("A's draft edit follows to B", async () => {
		const server = new FakeSyncServer();
		const broker = new TestBroker();
		const a = spawn("a", server);
		const b = spawn("b", server);
		const wroteA = author(a, server, broker);
		const listensB = listener(b, broker);

		const draft = await a.authoring.createDraft();
		await a.authoring.updateDraft(draft.id, { title: "Added a title" });
		await wroteA.settle();
		await listensB.settle();

		expect((await b.authoring.getDraft(draft.id))?.title).toBe("Added a title");
		expect(new Set(listensB.reasons)).toEqual(new Set(["remote-wake"]));
	});

	/**
	 * Wake must react only to remote changes. If B's own local edit re-triggered wake, a loop would
	 * form: pull → write → signal → pull.
	 */
	it("B's local writes make no wake", async () => {
		const server = new FakeSyncServer();
		const broker = new TestBroker();
		const a = spawn("a", server);
		const b = spawn("b", server);
		author(a, server, broker);
		const listensB = listener(b, broker);
		await listensB.settle();
		const before = listensB.reasons.length;

		await b.chat.createRoom({
			originStoryId: null,
			seed: seed("B's room"),
			title: "B's room",
		});
		await listensB.settle();

		expect(listensB.reasons.length).toBe(before);
	});

	/**
	 * Notifications at or below the device's own cursor are filtered out. Once B has caught up,
	 * repeated cursors do not increase the number of runs.
	 */
	it("duplicate notices after catching up add no runs", async () => {
		const server = new FakeSyncServer();
		const broker = new TestBroker();
		const a = spawn("a", server);
		const b = spawn("b", server);
		const wroteA = author(a, server, broker);
		const listensB = listener(b, broker);

		await a.chat.createRoom({
			originStoryId: null,
			seed: seed("Once"),
			title: "Once",
		});
		await wroteA.settle();
		await listensB.settle();
		const runs = listensB.runs();

		const cursor = server.cursor();
		for (let i = 0; i < 20; i++) broker.publish(cursor);
		await listensB.settle();

		expect(listensB.runs()).toBe(runs);
	});

	/**
	 * Stopping the stream means later notifications wake nothing. This is the shape of logout and
	 * account switching.
	 */
	it("after the stream stops, later notices do nothing", async () => {
		const server = new FakeSyncServer();
		const broker = new TestBroker();
		const a = spawn("a", server);
		const b = spawn("b", server);
		const wroteA = author(a, server, broker);
		const listensB = listener(b, broker);
		await listensB.settle();

		listensB.wake.stop();

		const room = await a.chat.createRoom({
			originStoryId: null,
			seed: seed("Room not received"),
			title: "Room not received",
		});
		await wroteA.settle();
		await listensB.settle();

		expect(await b.chat.getRoom(room.id)).toBeNull();
		expect(listensB.reasons).toEqual([]);
	});
});
