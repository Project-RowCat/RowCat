import {
	DEFAULT_LOCALE_PREFERENCE,
	type LocalePreference,
	parseLocalePreference,
} from "./locale.ts";

/**
 * The language preference: this device's value, not the member's — the same axis and the same
 * rules as the appearance preference (`lib/appearance/preference.ts`).
 *
 * The value is needed before anyone is signed in: the sign-in screen, the waiting screen and a guest
 * all have a language. Per-member storage has no place for those, and signing out then in as Bob
 * would switch the language, which nobody chose. So it lives in the device key-value store, and a
 * local data reset (which removes one member's database) leaves it alone.
 *
 * It is not on the account either. The web keeps its choice per browser (a cookie) for the same
 * reason: a guest needs one, and one device's language is a sensible default for the next person on
 * it, which is not true of anything account-scoped.
 *
 * Reads are lenient: an unknown value, a corrupt value or a read that throws are all `system`. The
 * first frame reads this, and the worst outcome must be "follow the phone".
 */

/** The entry name, with no member id: a guest's choice needs a place too. */
export const LOCALE_PREFERENCE_KEY = "rowcat.locale.preference";

/** Synchronous reads (the first frame needs the answer), asynchronous writes. */
export interface LocalePreferenceStorage {
	/** Never throws; failures return `null`. */
	read(): string | null;
	write(value: string): Promise<void>;
}

export interface LocalePreferenceStore {
	load(): LocalePreference;
	/** Never throws: the screen is already drawn in the new language. */
	save(preference: LocalePreference): Promise<void>;
}

export function createLocalePreferenceStore(
	storage: LocalePreferenceStorage,
): LocalePreferenceStore {
	return {
		load() {
			try {
				return parseLocalePreference(storage.read());
			} catch {
				return DEFAULT_LOCALE_PREFERENCE;
			}
		},
		async save(preference) {
			try {
				await storage.write(preference);
			} catch {
				/**
				 * Swallowed, as the appearance preference does. The new language is already on screen, and a
				 * failure message about saving it would ask the person to do something they cannot.
				 */
			}
		},
	};
}
