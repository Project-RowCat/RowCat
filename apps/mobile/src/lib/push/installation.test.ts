import { describe, expect, it } from "vitest";
import {
	createPushInstallationStore,
	newPushInstallationId,
	PUSH_INSTALLATION_KEY,
	type PushInstallationStorage,
} from "./installation.ts";

/**
 * Installation identity: random, not a fingerprint.
 */

/** A deterministic randomness source, so the contract's shape can be checked by value. */
const counter = () => {
	let n = 0;
	return (length: number) =>
		Uint8Array.from({ length }, () => {
			n += 1;
			return n & 0xff;
		});
};

const memory = (
	initial: string | null = null,
): PushInstallationStorage & {
	value: string | null;
	writes: number;
} => {
	const store = {
		value: initial,
		writes: 0,
		read: () => store.value,
		write: async (value: string) => {
			store.value = value;
			store.writes += 1;
		},
	};
	return store;
};

describe("format", () => {
	it("the shape the server contract accepts (32-char hex)", () => {
		expect(newPushInstallationId(counter())).toMatch(/^[0-9a-f]{32}$/);
	});
});

describe("storage", () => {
	it("creates and writes one when missing", async () => {
		const storage = memory();
		const store = createPushInstallationStore(storage, counter());
		const id = await store.resolve();
		expect(id).toMatch(/^[0-9a-f]{32}$/);
		expect(storage.value).toBe(id);
	});

	it("uses it as is when present — it doesn't change on every launch", async () => {
		const stored = "a".repeat(32);
		const storage = memory(stored);
		const store = createPushInstallationStore(storage, counter());
		expect(await store.resolve()).toBe(stored);
		expect(storage.writes).toBe(0);
	});

	/** A corrupted value must not produce a request the server contract would reject. */
	it("discards a misshapen value and makes a new one", async () => {
		const storage = memory("not-an-installation-id");
		const store = createPushInstallationStore(storage, counter());
		expect(await store.resolve()).toMatch(/^[0-9a-f]{32}$/);
	});

	/**
	 * Even if the write fails, this run still uses the value; a device that receives nothing is far
	 * costlier.
	 */
	it("returns the value even when writing fails", async () => {
		const storage: PushInstallationStorage = {
			read: () => null,
			write: async () => {
				throw new Error("no disk");
			},
		};
		const store = createPushInstallationStore(storage, counter());
		expect(await store.resolve()).toMatch(/^[0-9a-f]{32}$/);
	});

	it("the app doesn't stop even when reading throws", async () => {
		const storage: PushInstallationStorage = {
			read: () => {
				throw new Error("locked");
			},
			write: async () => {},
		};
		const store = createPushInstallationStore(storage, counter());
		expect(await store.resolve()).toMatch(/^[0-9a-f]{32}$/);
	});

	it("the same value within one run", async () => {
		const store = createPushInstallationStore(memory(), counter());
		expect(await store.resolve()).toBe(await store.resolve());
	});
});

describe("storage location", () => {
	/** A device storage entry, not an entry in the member database. */
	it("the key follows the device storage convention", () => {
		expect(PUSH_INSTALLATION_KEY).toBe("rowcat.push.installationId");
	});
});
