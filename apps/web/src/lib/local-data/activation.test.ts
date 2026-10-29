import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createLocalDataActivation,
	type LocalDataDriver,
	type LocalDataStores,
} from "./activation.ts";
import { activeLocalDbScope, resetLocalDbScope } from "./db.ts";

/**
 * Activation-order tests. What breaks here is account isolation, and the failure is silent: if a
 * previous member's activation finishes late and becomes the next member's store, the screen looks
 * normal but shows the previous member's conversations and drafts.
 *
 * The race is not simulated with setTimeout. Any delay is a matter of luck, and on a slow CI day
 * the order could invert and the test would pass. Driver loading is instead gated on promises that
 * the test resolves by hand, which pins the order.
 */

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

/**
 * Stands in for a store. This layer never reads store contents, only which member the stores belong
 * to.
 */
const stubStores = (viewerId: string): LocalDataStores =>
	({
		chat: { viewerId },
		authoring: { viewerId },
	}) as unknown as LocalDataStores;

function stubDriver() {
	const opened: string[] = [];
	const reset = vi.fn();
	const driver: LocalDataDriver = {
		open: (viewerId) => {
			opened.push(viewerId);
			return stubStores(viewerId);
		},
		reset,
	};
	return { driver, opened, reset };
}

afterEach(() => {
	resetLocalDbScope();
});

describe("activation timing", () => {
	it("calling without waiting for an effect still opens that member's store", async () => {
		/**
		 * This test is the reason for the fix. Activation used to start only from an effect, so a click
		 * made before the effect ran got 'no store' even though nothing was wrong. That window made the
		 * `Start conversation` action fail.
		 */
		const { driver, opened } = stubDriver();
		const onOpen = vi.fn();
		const activation = createLocalDataActivation({
			onOpen,
			load: async () => driver,
		});

		const stores = await activation.ensure("alice");

		expect(stores).not.toBeNull();
		expect(opened).toEqual(["alice"]);
		expect(onOpen).toHaveBeenCalledWith("alice", stores);
	});

	it("duplicate requests for the same member open the database once", async () => {
		// The click starts activation first and the effect follows. Both must share the same activation.
		const { driver, opened } = stubDriver();
		const activation = createLocalDataActivation({
			onOpen: () => {},
			load: async () => driver,
		});

		const [first, second] = await Promise.all([
			activation.ensure("alice"),
			activation.ensure("alice"),
		]);

		expect(opened).toEqual(["alice"]);
		expect(first).toBe(second);
	});
});

describe("account isolation", () => {
	it("an account switch mid-activation drops the late previous result", async () => {
		/**
		 * Pins this order: Alice's activation starts, the switch to Bob starts Bob's activation, Bob
		 * completes, and Alice completes late.
		 *
		 * If Alice opened the database at that point, the global scope's last owner would become Alice:
		 * the screen shows Bob while the store is Alice.
		 */
		const { driver, opened, reset } = stubDriver();
		const aliceLoad = deferred<LocalDataDriver>();
		const bobLoad = deferred<LocalDataDriver>();
		const loads = [aliceLoad, bobLoad];
		const onOpen = vi.fn();
		const activation = createLocalDataActivation({
			onOpen,
			load: () => loads.shift()?.promise ?? Promise.reject(new Error("over")),
		});

		const alicePending = activation.ensure("alice");
		const bobPending = activation.ensure("bob");

		bobLoad.resolve(driver);
		expect(await bobPending).not.toBeNull();

		aliceLoad.resolve(driver);
		expect(await alicePending).toBeNull();

		// Alice must not be opened at all. Opening and discarding afterward is not enough, because the
		// moment it opens, the global scope has already moved.
		expect(opened).toEqual(["bob"]);
		expect(onOpen).toHaveBeenCalledTimes(1);
		expect(onOpen).toHaveBeenCalledWith("bob", expect.anything());
		expect(reset).not.toHaveBeenCalled();
		expect(activation.owner()).toBe("bob");
	});

	it("a late activation after dropping to guest does not open the store", async () => {
		const { driver, opened } = stubDriver();
		const load = deferred<LocalDataDriver>();
		const onOpen = vi.fn();
		const activation = createLocalDataActivation({
			onOpen,
			load: () => load.promise,
		});

		const pending = activation.ensure("alice");
		activation.release();
		load.resolve(driver);

		expect(await pending).toBeNull();
		expect(opened).toEqual([]);
		expect(onOpen).not.toHaveBeenCalled();
		expect(activation.owner()).toBeNull();
	});

	it("a late release does not close a newly opened scope", async () => {
		/**
		 * The path where the same account signs back in right after logout. Release also goes through a
		 * dynamic import, so without a check, the database just opened would be closed by the earlier
		 * logout.
		 */
		const { driver, opened, reset } = stubDriver();
		const load = deferred<LocalDataDriver>();
		const activation = createLocalDataActivation({
			onOpen: () => {},
			load: () => load.promise,
		});

		// Release and re-activation wait on the same load. Whichever resumes first, only the last intent
		// (Alice) should survive.
		activation.release();
		const pending = activation.ensure("alice");
		load.resolve(driver);
		const stores = await pending;
		await Promise.resolve();
		await Promise.resolve();

		expect(stores).not.toBeNull();
		expect(opened).toEqual(["alice"]);
		expect(reset).not.toHaveBeenCalled();
		expect(activation.owner()).toBe("alice");
	});

	it("with the real driver only the last owner stays open", async () => {
		// Verify against the real Dexie and global scope rather than a stub. The final judgment on
		// isolation is made there.
		const onOpen = vi.fn();
		const activation = createLocalDataActivation({ onOpen });

		await activation.ensure("iso-alice");
		expect(activeLocalDbScope()).toBe("iso-alice");

		await activation.ensure("iso-bob");
		expect(activeLocalDbScope()).toBe("iso-bob");
		expect(activation.owner()).toBe("iso-bob");
	});
});

describe("open failures", () => {
	it("failures are not cached; the next attempt opens again", async () => {
		/**
		 * Holding a rejected promise would turn a transient failure (storage briefly full, another tab
		 * holding an upgrade) into a permanent one for that tab. The user would see `Start conversation` never work
		 * until a reload.
		 */
		const { driver, opened } = stubDriver();
		let attempt = 0;
		const activation = createLocalDataActivation({
			onOpen: () => {},
			load: async () => {
				attempt += 1;
				if (attempt === 1) throw new Error("cannot open the store");
				return driver;
			},
		});

		expect(await activation.ensure("alice")).toBeNull();
		expect(opened).toEqual([]);

		expect(await activation.ensure("alice")).not.toBeNull();
		expect(opened).toEqual(["alice"]);
	});
});
