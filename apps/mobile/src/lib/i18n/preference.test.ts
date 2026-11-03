import { describe, expect, it } from "vitest";
import {
	createLocalePreferenceStore,
	LOCALE_PREFERENCE_KEY,
	type LocalePreferenceStorage,
} from "./preference.ts";

/**
 * The language preference's storage rules — the appearance preference's rules, on another key. A
 * mistake here is silent: one corrupt value stops the app starting, or the language flips when
 * accounts switch.
 */

function memory(initial?: string): LocalePreferenceStorage {
	let value = initial ?? null;
	return {
		read: () => value,
		async write(next) {
			value = next;
		},
	};
}

describe("reading", () => {
	it("nothing saved follows the phone", () => {
		expect(createLocalePreferenceStore(memory()).load()).toBe("system");
	});

	it("the app opens even when reading throws", () => {
		const broken: LocalePreferenceStorage = {
			read: () => {
				throw new Error("couldn't open the store");
			},
			write: async () => {},
		};
		expect(createLocalePreferenceStore(broken).load()).toBe("system");
	});
});

describe("writing", () => {
	it("the choice remains on the next run", async () => {
		const storage = memory();
		await createLocalePreferenceStore(storage).save("ko");
		expect(createLocalePreferenceStore(storage).load()).toBe("ko");
	});

	it("a failed save doesn't throw — the new language is already on screen", async () => {
		const broken: LocalePreferenceStorage = {
			read: () => null,
			write: () => Promise.reject(new Error("the disk is full")),
		};
		await expect(
			createLocalePreferenceStore(broken).save("en"),
		).resolves.toBeUndefined();
	});
});

/** No member id in the key: a guest needs a place for the choice, and signing in must not change it. */
it("the key holds no identity", () => {
	expect(LOCALE_PREFERENCE_KEY).toBe("rowcat.locale.preference");
	expect(LOCALE_PREFERENCE_KEY).not.toMatch(/viewer|member|user|\$\{/);
});
