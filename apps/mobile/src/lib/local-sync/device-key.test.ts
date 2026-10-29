import { AEAD, bytesToB64 } from "@rowcat/sync";
import { describe, expect, it } from "vitest";
import { createMemorySecureStorage } from "../../test/sqlite-node.ts";
import { createMobileDeviceKeyStore, deviceKeyEntry } from "./device-key.ts";

/**
 * Device key: **what this file checks is the rules, not the storage medium.**
 *
 * Whether the Keychain really keeps the value, and whether it survives an app kill and relaunch, is
 * the job of simulator QA (`README.md`). What is checked here is three things on top of that: the
 * per-member key name, the encoding, and whether a corrupt value is **treated as absent**.
 */

const DEK = new Uint8Array(AEAD.keyBytes).map((_, i) => i);

describe("key name", () => {
	it("differs per member, and the same member is always the same", () => {
		expect(deviceKeyEntry("alice")).not.toBe(deviceKeyEntry("bob"));
		expect(deviceKeyEntry("alice")).toBe(deviceKeyEntry("alice"));
	});

	it("uses only characters SecureStore accepts and doesn't hold the member id in plain text", () => {
		const entry = deviceKeyEntry("alice@example.com/../..");
		expect(entry).toMatch(/^[A-Za-z0-9._-]+$/);
		expect(entry).not.toContain("alice");
	});
});

describe("remember · recall · release", () => {
	it("after remembering, the same bytes come out", async () => {
		const storage = createMemorySecureStorage();
		const store = createMobileDeviceKeyStore(storage, "alice");

		expect(await store.recall()).toBeNull();
		await store.remember(DEK);
		expect(await store.recall()).toEqual(DEK);

		await store.forget();
		expect(await store.recall()).toBeNull();
	});

	it("Alice's key doesn't come out of Bob's store", async () => {
		const storage = createMemorySecureStorage();
		await createMobileDeviceKeyStore(storage, "alice").remember(DEK);
		expect(
			await createMobileDeviceKeyStore(storage, "bob").recall(),
		).toBeNull();
	});

	it("release deletes only this member's entry", async () => {
		const storage = createMemorySecureStorage();
		await createMobileDeviceKeyStore(storage, "alice").remember(DEK);
		await createMobileDeviceKeyStore(storage, "bob").remember(DEK);

		await createMobileDeviceKeyStore(storage, "alice").forget();

		expect(await createMobileDeviceKeyStore(storage, "bob").recall()).toEqual(
			DEK,
		);
	});

	it("a value whose length differs from the spec **is the same as none** — it isn't trimmed to fit", async () => {
		const storage = createMemorySecureStorage();
		await storage.set(deviceKeyEntry("alice"), bytesToB64(new Uint8Array(16)));
		expect(
			await createMobileDeviceKeyStore(storage, "alice").recall(),
		).toBeNull();
	});

	it("values that aren't base64 don't throw either and fold to none", async () => {
		const storage = createMemorySecureStorage();
		await storage.set(deviceKeyEntry("alice"), "this isn't base64!!");
		/**
		 * Throwing would fail the whole screen entry and the user would not even get a chance to enter
		 * the recovery code. Returning null sends the controller to the locked state and opens the normal
		 * unlock path.
		 */
		expect(
			await createMobileDeviceKeyStore(storage, "alice").recall(),
		).toBeNull();
	});

	it("doesn't claim the DEK isn't kept in plain text in the store", async () => {
		/**
		 * Stated honestly: what is stored here is the **DEK itself** in base64. It is not wrapped,
		 * because the wrapping key would have to live somewhere else, and that place would be the same
		 * secret store. One more layer would not change the trust boundary. What protects this value is
		 * the Keychain/Keystore, not our code, so the whole rule is simply: do not put it in SQLite.
		 */
		const storage = createMemorySecureStorage();
		await createMobileDeviceKeyStore(storage, "alice").remember(DEK);
		expect(storage.entries().get(deviceKeyEntry("alice"))).toBe(
			bytesToB64(DEK),
		);
	});
});
