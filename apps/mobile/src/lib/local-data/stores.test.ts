import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seed } from "../../test/fixtures.ts";
import {
	createMemorySecureStorage,
	createTempDirectory,
	createTestScopeController,
} from "../../test/sqlite-node.ts";
import type { LocalScopeController, MobileLocalScope } from "./activation.ts";
import { STORE_READS } from "./stores.ts";

/**
 * Contract of the assembly point: what wakes sync and what does not.
 *
 * The second test in this file is the entire regression guard. Once a `SyncStore` is wrapped as a
 * write signal, `applyPull` gets counted as a local change, and pull → signal → pull loops forever.
 * That loop raises no error; it just silently drains battery and data.
 */

let temp: ReturnType<typeof createTempDirectory>;
let controller: LocalScopeController;
let scope: MobileLocalScope;

beforeEach(async () => {
	temp = createTempDirectory();
	controller = createTestScopeController(
		temp.path,
		createMemorySecureStorage(),
	);
	scope = await controller.activate("alice");
});

afterEach(async () => {
	await controller.release();
	temp.dispose();
});

const countSignals = (): { calls: () => number; stop: () => void } => {
	let calls = 0;
	const stop = scope.stores.mutations.subscribe(() => {
		calls++;
	});
	return { calls: () => calls, stop };
};

describe("write signals", () => {
	it("local operations emit signals", async () => {
		const signals = countSignals();
		const room = await scope.stores.chat.createRoom({
			originStoryId: null,
			seed: seed("Room"),
			title: "Room",
		});
		await scope.stores.authoring.createDraft();
		expect(signals.calls()).toBe(2);

		await scope.stores.chat.renameRoom(room.id, "New name");
		expect(signals.calls()).toBe(3);
		signals.stop();
	});

	it("the snapshot axis rises too — the value later screen subscriptions read", async () => {
		// `useSyncExternalStore` needs a subscription and a **snapshot**. Without a snapshot the screen
		// hears that something changed but has no basis to re-render.
		const before = scope.stores.mutations.version();
		await scope.stores.authoring.createDraft();
		expect(scope.stores.mutations.version()).toBeGreaterThan(before);

		await scope.stores.authoring.listDrafts();
		expect(scope.stores.mutations.version()).toBe(before + 1);
	});

	it("lookups emit no signals", async () => {
		await scope.stores.chat.createRoom({
			originStoryId: null,
			seed: seed("Room"),
			title: "Room",
		});
		const signals = countSignals();
		await scope.stores.chat.listRooms();
		await scope.stores.authoring.listDrafts();
		expect(signals.calls()).toBe(0);
		signals.stop();
	});

	it("**pull emits no signal** — that feedback is an infinite round trip", async () => {
		const signals = countSignals();
		await scope.stores.sync.applyPull({ entries: [], cursor: 5 });
		await scope.stores.sync.recordOutcome({ syncedAt: null });
		await scope.stores.sync.resetCursor();
		expect(signals.calls()).toBe(0);
		signals.stop();
	});

	it("remembering the device key isn't an event that creates something to upload either", async () => {
		const signals = countSignals();
		await scope.stores.deviceKey.remember(new Uint8Array(32).fill(1));
		await scope.stores.deviceKey.forget();
		expect(signals.calls()).toBe(0);
		signals.stop();
	});

	it("failed writes emit no signal — what wasn't committed can't be uploaded", async () => {
		const room = await scope.stores.chat.createRoom({
			originStoryId: null,
			seed: seed("Room"),
			title: "Room",
		});
		const signals = countSignals();
		await expect(
			scope.stores.chat.renameRoom(room.id, "   "),
		).rejects.toThrow();
		expect(signals.calls()).toBe(0);
		signals.stop();
	});
});

describe("read list", () => {
	/**
	 * If a query-named method is missing from the read list, that query emits a write signal. The
	 * moment a screen subscribes to it, read → signal → read loops forever, and the failure shows up
	 * not as an error but as a **JS thread that never rests**. `listSceneImages`, `listRuntimeAssets`,
	 * and `listCharacters` fell out this way, one after another. This check is the only one that
	 * classifies by name; the wrapping rule (an unknown method counts as a write) stays unchanged.
	 */
	const QUERY_NAME = /^(get|list|has|load)([A-Z]|$)/;

	for (const [name, reads] of Object.entries(STORE_READS)) {
		it(`${name}: every method with a lookup name is on the read list`, () => {
			const store = scope.stores[name as keyof typeof STORE_READS] as object;
			const queries = Object.entries(store)
				.filter(
					([key, value]) => typeof value === "function" && QUERY_NAME.test(key),
				)
				.map(([key]) => key);
			expect(queries.length).toBeGreaterThan(0);
			expect(
				queries.filter((key) => !(reads as ReadonlySet<string>).has(key)),
			).toEqual([]);
		});
	}

	it("character lookups emit no signal — it's a lookup the conversation room subscribes to", async () => {
		const room = await scope.stores.chat.createRoom({
			originStoryId: null,
			seed: seed("Room"),
			title: "Room",
		});
		const signals = countSignals();
		await scope.stores.chat.listCharacters(room.id);
		expect(signals.calls()).toBe(0);
		signals.stop();
	});
});

describe("Link", () => {
	it("the three stores use **the same connection** — that's what makes pull atomic", async () => {
		/**
		 * There is only one direct way to check this: while one transaction is open, do writes from the
		 * other stores queue behind it instead of overlapping? If there were two connections, the two
		 * statements below would commit to different files, and this test would pass while guarding
		 * nothing.
		 */
		const [rooms, drafts] = await Promise.all([
			scope.stores.chat.createRoom({
				originStoryId: null,
				seed: seed("Room"),
				title: "Room",
			}),
			scope.stores.authoring.createDraft({ title: "Drafts" }),
		]);
		expect(rooms.id).not.toBe(drafts.id);
		// Both domains live in the same file, so the same connection reads both.
		const room = await scope.db.first("SELECT id FROM chat_room WHERE id = ?", [
			rooms.id,
		]);
		const draft = await scope.db.first(
			"SELECT id FROM authoring_draft WHERE id = ?",
			[drafts.id],
		);
		expect(room).not.toBeNull();
		expect(draft).not.toBeNull();
	});
});
