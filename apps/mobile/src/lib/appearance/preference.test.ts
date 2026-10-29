import { describe, expect, it } from "vitest";
import {
	APPEARANCE_PREFERENCE_KEY,
	type AppearancePreferenceStorage,
	createAppearancePreferenceStore,
	parseAppearancePreference,
} from "./preference.ts";

/**
 * Device appearance preference: the storage rules. A mistake here fails silently: one corrupt value
 * stops the app from starting, someone who chose dark sees light once on every launch, or the
 * brightness reverts when switching accounts.
 */

function memoryStorage(initial?: string): AppearancePreferenceStorage & {
	entries: Map<string, string>;
} {
	const entries = new Map<string, string>();
	if (initial !== undefined) entries.set(APPEARANCE_PREFERENCE_KEY, initial);
	return {
		entries,
		read: () => entries.get(APPEARANCE_PREFERENCE_KEY) ?? null,
		async write(value) {
			entries.set(APPEARANCE_PREFERENCE_KEY, value);
		},
	};
}

describe("reading is lenient", () => {
	it("no saved value means system", () => {
		expect(createAppearancePreferenceStore(memoryStorage()).load()).toBe(
			"system",
		);
	});

	it("reads the three values as is", () => {
		for (const value of ["system", "light", "dark"] as const)
			expect(createAppearancePreferenceStore(memoryStorage(value)).load()).toBe(
				value,
			);
	});

	/** Hand-edited values, values from an older build, and truncated strings all fall into the same bucket. */
	it("unknown values fall to system", () => {
		for (const value of ["", "DARK", "Dark", "auto", "{}", "null"])
			expect(
				createAppearancePreferenceStore(memoryStorage(value)).load(),
				value,
			).toBe("system");
	});

	/**
	 * The vocabulary is case-sensitive. Being lenient would give the stored value two canonical
	 * spellings, and the next person extending the values could not tell which one to compare against.
	 */
	it("doesn't fold case", () => {
		expect(parseAppearancePreference("Light")).toBe("system");
		expect(parseAppearancePreference("light")).toBe("light");
	});

	/**
	 * This is the first frame that reads the value. Throwing would show the user the app failing to
	 * start, not a setting; the worst outcome must be "follow the OS".
	 */
	it("the app opens even when reading throws", () => {
		const broken: AppearancePreferenceStorage = {
			read: () => {
				throw new Error("couldn't open the store");
			},
			write: async () => {},
		};
		expect(createAppearancePreferenceStore(broken).load()).toBe("system");
	});
});

describe("writing", () => {
	it("the chosen value remains on the next run", async () => {
		const storage = memoryStorage();
		const store = createAppearancePreferenceStore(storage);

		await store.save("dark");
		expect(createAppearancePreferenceStore(storage).load()).toBe("dark");

		await store.save("light");
		expect(createAppearancePreferenceStore(storage).load()).toBe("light");
	});

	/**
	 * A save failure gives the user nothing to act on: the screen is already drawn in the new
	 * brightness. Throwing would force the caller to show that failure somewhere, and the copy would
	 * explain nothing to the person who chose the brightness.
	 */
	it("doesn't throw even when writing fails", async () => {
		const broken: AppearancePreferenceStorage = {
			read: () => null,
			write: () => Promise.reject(new Error("The disk is full")),
		};
		await expect(
			createAppearancePreferenceStore(broken).save("dark"),
		).resolves.toBeUndefined();
	});
});

describe("this value belongs to the device", () => {
	/**
	 * The key carries no member id. If it did, there would be no place for a guest's choice, and the
	 * brightness would change on sign-in. It must survive `Alice → sign out → Bob`.
	 */
	it("the key holds no identity", () => {
		expect(APPEARANCE_PREFERENCE_KEY).toBe("rowcat.appearance.preference");
		expect(APPEARANCE_PREFERENCE_KEY).not.toMatch(/viewer|member|user|\$\{/);
	});

	/** Switching accounts uses the same storage and key, so the value is unchanged. */
	it("the value stays when the account switches", async () => {
		const device = memoryStorage();

		// Alice chooses dark.
		await createAppearancePreferenceStore(device).save("dark");
		// Sign out → Bob signs in. The storage is device-owned, so there is only one.
		expect(createAppearancePreferenceStore(device).load()).toBe("dark");
	});
});
