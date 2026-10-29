import { providerCredentialEntries } from "../local-provider/record.ts";
import type { SecureKeyStorage } from "../local-sync/device-key.ts";
import { deviceKeyEntry } from "../local-sync/device-key.ts";
import { viewerDatabaseName, viewerDraftCoverDirName } from "./database.ts";

/**
 * Erases **one member's local data in full** on this device.
 *
 * Account deletion and local reset are the callers. No screen calls it yet (#94: product settings
 * do not offer "erase everything"), and that is intended. The function exists now so that the fact
 * "data to erase lives in more than one place" is written down in one place. When an account
 * deletion path appears later, code that drops the database and forgets the Keychain would leave
 * the deleted account's DEK on the device.
 *
 * The name points at one member on purpose. No sweep of the storage by prefix: that would also
 * delete **other members** on the same device (web's `deleteLocalDbForViewer` is narrow for the
 * same reason).
 *
 * **Nothing on the server is touched.** Local deletion follows server deletion, not the reverse.
 * Reversing the order would wipe conversations and drafts even when the server refuses the account
 * deletion.
 */
export interface LocalPurgeTargets {
	deleteDatabase(name: string): Promise<void>;
	secureStorage: SecureKeyStorage;
	/**
	 * Removes the whole directory where draft cover files live. Succeeds even if it is absent.
	 *
	 * Injected for the same reason as the two above: if this function knew the file system, that rule
	 * would leak here, and the order could not be verified.
	 */
	deleteDraftCovers(dirName: string): void;
}

export async function deleteLocalDataForViewer(
	viewerId: string,
	targets: LocalPurgeTargets,
): Promise<void> {
	/**
	 * Cover files go before the database.
	 *
	 * The directory is per member, so wiping it does not touch other members, but the order still
	 * matters. If the database were deleted first and this step then failed, the member's covers would
	 * remain as files that no row points at, and the next run would lose the way to find them. In the
	 * reverse order the worst case is "files gone, row still there", and that row is removed together
	 * with the database right after.
	 */
	targets.deleteDraftCovers(viewerDraftCoverDirName(viewerId));
	await targets.deleteDatabase(viewerDatabaseName(viewerId));
	await targets.secureStorage.remove(deviceKeyEntry(viewerId));
	/**
	 * BYO provider API keys are local data on this device too.
	 *
	 * This list is the only statement of that fact. Settings reset and account deletion both pass
	 * through this function, so there is no second place to write the same line, where it would
	 * eventually be fixed on one side only.
	 *
	 * Names are enumerated and deleted rather than swept by prefix. A prefix sweep would also remove
	 * other members' keys on the same device, the mistake this function exists to avoid. The names are
	 * deterministic (`providerCredentialEntry`), so enumeration is possible; when a provider is added,
	 * its entry joins this list and the path widens with it.
	 *
	 * Deleting a missing entry is success. This cleanup must be re-runnable after a partial failure.
	 */
	for (const entry of providerCredentialEntries(viewerId))
		await targets.secureStorage.remove(entry);
}
