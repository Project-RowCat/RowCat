import type { ThemePreference } from "@rowcat/ui-native";

/**
 * Device appearance preference: this device's value, not the member's.
 *
 * The value is needed outside sign-in: during boot (identity not yet known), on the sign-in screen
 * (guest), after a session failure (membership unknown), and on member screens. All four must draw
 * the same brightness. Per-member storage has no place for the first three, and sign-out then
 * sign-in as Bob would reset the brightness, which the user never chose. So the storage sits
 * outside the member scope, and resetting this device's local data does not clear it (that
 * operation removes only one member's database).
 *
 * Account theme (presets, custom colors) is the opposite axis: the server owns it and it follows
 * the user to other signed-in devices (`features/theme/viewer-theme-override.tsx`).
 *
 * ## The storage medium sits behind a port
 *
 * This file knows neither `expo-sqlite` nor `SecureStore`. The device supplies a SQLite key-value
 * store and tests supply an in-memory map, so the read tolerance and write rules are verified
 * without a simulator. `light`/`dark`/`system` are not secrets, so they are not kept in Keychain
 * (that store holds the DEK).
 *
 * ## Reads are lenient
 *
 * Corrupt values, unknown values and read failures all fall back to `system`. The first frame reads
 * this value, so throwing would show the user the app failing to start; the worst outcome must be
 * "follow the OS".
 */

/**
 * The entry name, with no member id. Including an identity would leave no place for a guest's
 * choice, and the brightness would change on sign-in. The absence of identity is how this value is
 * expressed as device-owned.
 */
export const APPEARANCE_PREFERENCE_KEY = "rowcat.appearance.preference";

/** Default for a device that has chosen nothing. Matches the web default. */
export const DEFAULT_APPEARANCE_PREFERENCE: ThemePreference = "system";

const VALUES: readonly ThemePreference[] = ["system", "light", "dark"];

/** All choosable values, also the order the screen draws them (widest first). */
export const APPEARANCE_PREFERENCES = VALUES;

/**
 * Stored string → preference. Unknown values become `system`.
 *
 * Case is not folded: this is vocabulary and only our code writes it, so leniency would give the
 * stored value two canonical spellings (the account preset makes the same decision).
 */
export function parseAppearancePreference(
	value: string | null | undefined,
): ThemePreference {
	return VALUES.includes(value as ThemePreference)
		? (value as ThemePreference)
		: DEFAULT_APPEARANCE_PREFERENCE;
}

/**
 * Storage medium: synchronous reads, asynchronous writes.
 *
 * The synchronous read is the most important axis of this port. A value arriving after the first
 * frame produces a flicker (`stored dark → first frame light → second frame dark`) on every launch.
 * Writes are not urgent: the screen is already drawn in the new value, and saving is for the next
 * launch.
 */
export interface AppearancePreferenceStorage {
	/** Never throws; failures return `null` (the implementation folds them). */
	read(): string | null;
	write(value: string): Promise<void>;
}

export interface AppearancePreferenceStore {
	/** Current stored value. Returns `system` if it cannot be read. */
	load(): ThemePreference;
	/**
	 * Saves the new value. Never throws: the screen is already drawn in the new brightness, and the
	 * user has nothing to do about a failed save (they can simply choose again).
	 */
	save(preference: ThemePreference): Promise<void>;
}

export function createAppearancePreferenceStore(
	storage: AppearancePreferenceStorage,
): AppearancePreferenceStore {
	return {
		load() {
			try {
				return parseAppearancePreference(storage.read());
			} catch {
				return DEFAULT_APPEARANCE_PREFERENCE;
			}
		},
		async save(preference) {
			try {
				await storage.write(preference);
			} catch {
				/**
				 * Swallowing is the rule. The user can do nothing about this failure, and a toast would make a
				 * person who chose a brightness read a failure message they cannot act on
				 * (`docs/design/FAILURE-FEEDBACK.md`, the fourth line: a user-initiated action whose result is
				 * already on screen).
				 */
			}
		},
	};
}
