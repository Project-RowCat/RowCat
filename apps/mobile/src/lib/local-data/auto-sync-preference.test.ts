import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createMemorySecureStorage,
	createTempDirectory,
	createTestScopeController,
} from "../../test/sqlite-node.ts";
import type { LocalScopeController } from "./activation.ts";

/**
 * The auto-sync preference: pins the fact that it is **this device's, this member's value**.
 *
 * Runs on real SQLite: whether it survives reopening the same member, whether it leaks to another
 * member, and whether it stays off the sync axis (codecs and TABLE_ORDER).
 */

const ALICE = "alice-viewer-id";
const BOB = "bob-viewer-id";

let temp: ReturnType<typeof createTempDirectory>;
let controller: LocalScopeController;

beforeEach(() => {
	temp = createTempDirectory();
	controller = createTestScopeController(
		temp.path,
		createMemorySecureStorage(),
	);
});

afterEach(async () => {
	await controller.release();
	temp.dispose();
});

describe("default and persistence", () => {
	it("no record means on — setting up sync is a request to keep going", async () => {
		const alice = await controller.activate(ALICE);
		expect(await alice.stores.autoSyncPreference.isEnabled()).toBe(true);
	});

	it("the off value remains after closing and reopening the scope", async () => {
		const first = await controller.activate(ALICE);
		await first.stores.autoSyncPreference.setEnabled(false);
		await controller.release();

		const again = await controller.activate(ALICE);
		expect(await again.stores.autoSyncPreference.isEnabled()).toBe(false);

		await again.stores.autoSyncPreference.setEnabled(true);
		await controller.release();
		const third = await controller.activate(ALICE);
		expect(await third.stores.autoSyncPreference.isEnabled()).toBe(true);
	});
});

describe("isolation", () => {
	it("Alice's preference doesn't leak to Bob", async () => {
		const alice = await controller.activate(ALICE);
		await alice.stores.autoSyncPreference.setEnabled(false);

		const bob = await controller.activate(BOB);
		expect(await bob.stores.autoSyncPreference.isEnabled()).toBe(true);
	});
});

describe("not a sync axis", () => {
	it("preference writes create neither sync signals nor outbound records", async () => {
		const alice = await controller.activate(ALICE);
		let mutationSignals = 0;
		let preferenceSignals = 0;
		alice.stores.mutations.subscribe(() => mutationSignals++);
		alice.stores.preferences.subscribe(() => preferenceSignals++);

		await alice.stores.autoSyncPreference.setEnabled(false);

		/**
		 * Neither signal goes out — a `mutations` signal would wake a sync with nothing to upload, and a
		 * `preferences` signal would redraw the generation settings screen for no reason. This value's
		 * subscription belongs to the auto-sync adapter's snapshot.
		 */
		expect(mutationSignals).toBe(0);
		expect(preferenceSignals).toBe(0);

		/** Nor does it go outbound — the protocol does not know this value exists. */
		const outbound = await alice.stores.sync.collectOutbound({ limit: 100 });
		expect(outbound.records).toEqual([]);
	});

	it("the preference doesn't touch the sync state row's other axes", async () => {
		const alice = await controller.activate(ALICE);
		const before = await alice.stores.sync.readState();
		await alice.stores.autoSyncPreference.setEnabled(false);
		const after = await alice.stores.sync.readState();
		expect(after.cursor).toBe(before.cursor);
		expect(after.deviceId).toBe(before.deviceId);
		expect(after.initialSyncDone).toBe(before.initialSyncDone);
	});
});
