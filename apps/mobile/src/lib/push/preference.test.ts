import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	createPushPreferenceStore,
	PUSH_PREFERENCE_KEY,
	type PushPreferenceStorage,
	parsePushPreference,
} from "./preference.ts";

/**
 * This installation's receive decision: whether it **survives**, and whether it has **three
 * states**.
 *
 * The most expensive thing this file locks is the first group: the fact that the user tapped `Turn off
 * on this device` must still hold when the app is reopened. If it lived only in memory, the OS permission
 * would still be granted, automatic refresh would quietly re-register the installation, and the
 * user would read their action as having done nothing.
 */

/** Device storage that survives app restarts. A new instance still sees the value. */
function fakeStorage(initial: Record<string, string> = {}) {
	const values = { ...initial };
	return {
		values,
		port(key: string): PushPreferenceStorage {
			return {
				read: () => values[key] ?? null,
				write: async (value) => {
					values[key] = value;
				},
			};
		},
	};
}

describe("vocabulary", () => {
	it("only the two chosen values read as is", () => {
		expect(parsePushPreference("enabled")).toBe("enabled");
		expect(parsePushPreference("disabled")).toBe("disabled");
	});

	/**
	 * Reading a corrupted value or a string left by an older build as "turned off" would put a
	 * decision the user never made on this installation, and that state does not heal itself.
	 */
	it("unknown values fold to never chosen", () => {
		for (const stored of [null, undefined, "", "true", "off", "unset", "1"])
			expect(parsePushPreference(stored), String(stored)).toBe("unset");
	});
});

describe("Save", () => {
	let storage: ReturnType<typeof fakeStorage>;
	beforeEach(() => {
		storage = fakeStorage();
	});

	it("an installation that never chose is unset", () => {
		expect(
			createPushPreferenceStore(storage.port(PUSH_PREFERENCE_KEY)).read(),
		).toBe("unset");
	});

	/** **The reason this file exists.** Turning it off must survive until the next run. */
	it("the fact that it was explicitly turned off survives relaunching the app", async () => {
		const first = createPushPreferenceStore(storage.port(PUSH_PREFERENCE_KEY));
		await first.write("disabled");

		/** Same as a process restart: a new instance with no memory copy. */
		const second = createPushPreferenceStore(storage.port(PUSH_PREFERENCE_KEY));
		expect(second.read()).toBe("disabled");
	});

	it("the fact that it was explicitly turned on survives too", async () => {
		const first = createPushPreferenceStore(storage.port(PUSH_PREFERENCE_KEY));
		await first.write("enabled");
		expect(
			createPushPreferenceStore(storage.port(PUSH_PREFERENCE_KEY)).read(),
		).toBe("enabled");
	});

	/** Shares a namespace with the installation identity, but uses a separate entry. */
	it("doesn't overwrite the installation identity's entry", async () => {
		const shared = fakeStorage({
			"rowcat.push.installationId": "a".repeat(32),
		});
		await createPushPreferenceStore(shared.port(PUSH_PREFERENCE_KEY)).write(
			"disabled",
		);
		expect(shared.values["rowcat.push.installationId"]).toBe("a".repeat(32));
		expect(shared.values[PUSH_PREFERENCE_KEY]).toBe("disabled");
	});

	it("the app doesn't stop even when reading throws", () => {
		const store = createPushPreferenceStore({
			read: () => {
				throw new Error("storage");
			},
			write: async () => {},
		});
		expect(store.read()).toBe("unset");
	});

	/**
	 * Even if the save fails, **this run still uses the picked value**, the same judgement as the
	 * installation identity. If the process dies, the failure reverts to `unset`; that is the only
	 * limit this file accepts.
	 */
	it("even when writing fails this run uses the chosen value", async () => {
		const store = createPushPreferenceStore({
			read: () => null,
			write: () => Promise.reject(new Error("storage")),
		});
		await expect(store.write("disabled")).resolves.toBeUndefined();
		expect(store.read()).toBe("disabled");
	});

	it("doesn't open the store every time", async () => {
		const read = vi.fn(() => "disabled");
		const store = createPushPreferenceStore({ read, write: async () => {} });
		store.read();
		store.read();
		expect(read).toHaveBeenCalledTimes(1);
	});
});
