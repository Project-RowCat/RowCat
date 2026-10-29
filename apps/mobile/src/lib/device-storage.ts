import { SQLiteStorage } from "expo-sqlite/kv-store";

/**
 * Key-value storage for **this device**: where values live that sit outside the member scope.
 *
 * The test for what goes here is one question: *should it be the same regardless of sign-in state?*
 * The chosen appearance and the fact that an update note was seen both qualify. Both exist for
 * guests too, must not revert when the account changes, and are not values a local data reset of
 * one member should erase.
 *
 * ## A separate file from the member database
 *
 * The file name `rowcat_device.db` is the whole of that fact. Member files are
 * `rowcat_vnext_<hash>.db` (`local-data/database.ts`), and this device's local reset erases only
 * that one name. Clearing conversations and drafts therefore leaves the chosen appearance and the
 * read notes in place.
 *
 * ## Not `SecureStore`
 *
 * Neither `light`/`dark` nor "the August 30 note was read" is a secret. `SecureStore` holds the
 * sync DEK (`local-sync/device-key.ts`); putting non-secret values there would make its entry list
 * stop being "what this device protects".
 *
 * ## No new native dependency
 *
 * `expo-sqlite` is a dependency this app **already carries** (the member database lives on it), and
 * its SDK 57 package exports a key-value store of the same shape. No native rebuild and no new line
 * for `expo-doctor` to examine.
 *
 * ## Reads are synchronous
 *
 * Both consumers need the value **before the first frame**. A late appearance value would flash a
 * white screen on every launch, and a late "read" fact would show a note already dismissed for one
 * frame. Failures fold to `null`: an app that does not start because of these values is much worse.
 */

/** A name different from the member database. The local reset does not erase this file. */
const DEVICE_STORAGE_NAME = "rowcat_device.db";

let storage: SQLiteStorage | null = null;

/** Opened on first use, so merely loading the module does not create the file. */
const open = (): SQLiteStorage => {
	storage ??= new SQLiteStorage(DEVICE_STORAGE_NAME);
	return storage;
};

/** A narrow store bound to one key. Consumers know their own key, not the file name. */
export interface DeviceValueStorage {
	/** Never throws; failure is `null`. */
	read(): string | null;
	write(value: string): Promise<void>;
}

export function deviceValueStorage(key: string): DeviceValueStorage {
	return {
		read: () => {
			try {
				return open().getItemSync(key);
			} catch {
				return null;
			}
		},
		write: (value) => open().setItemAsync(key, value),
	};
}
