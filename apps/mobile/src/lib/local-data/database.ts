import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@rowcat/sync";
import { migrate } from "./migrations.ts";
import {
	createMobileDatabase,
	type MobileDatabase,
	type SqliteDriver,
} from "./sqlite.ts";

/**
 * Per-member local database. This is the app's **source-of-truth store**.
 *
 * The source of truth for conversations (rooms, messages, memories) and authoring (drafts and their
 * children) is here, not on the server. The server has no conversation or draft tables and will not
 * get them. Sync uploads only ciphertext that we cannot open. So this file must be treated as a
 * database, not a cache: schema changes are migrations, the name cannot be changed casually, and an
 * accidental deletion destroys the user's work.
 *
 * **Why three domains share one file** is this file's most important decision. `applyPull` must
 * commit the application of a page's records and the cursor advance in **one transaction**, and
 * that page carries rooms and drafts together. A SQLite transaction is atomic only within one
 * connection (that is, one file), so splitting files per domain would make that atomicity
 * impossible.
 */

/**
 * Member id to file name.
 *
 * The member id is not used as-is. The value is one we issue, but nothing in the contract
 * guarantees it is safe as a file name. Filtering out unusable characters can **fold two different
 * members into the same name**, and then Bob opens Alice's conversations. SHA-256 removes that
 * failure structurally. It also keeps the file name from becoming a member identifier, since the
 * device's file list appears in backup and diagnostic tools.
 *
 * **It must be deterministic.** When the same member signs in again, **the same file** must open,
 * so no random name or session value is mixed in.
 */
export const viewerDatabaseName = (viewerId: string): string =>
	`rowcat_vnext_${bytesToHex(sha256(utf8ToBytes(viewerId)))}.db`;

/**
 * The **directory where this member's pre-publication cover files lie** (one name under the
 * documents directory).
 *
 * It deliberately uses the **same derivation** as the database name. The fact that both locations
 * belong to the same member must be visible in the names, so that account deletion and reset can
 * remove them side by side (`purge.ts`). Without that, one would need a sweep by prefix, and that
 * sweep also deletes other members' files on the same device.
 *
 * The member id is not written in plain text, for the sake of location. The documents directory is
 * **backed up with the device** (iCloud), and path names in it survive in backups even after we
 * delete the files. This is the same judgment as hashing the credential item name.
 */
export const viewerDraftCoverDirName = (viewerId: string): string =>
	`draft-covers-${bytesToHex(sha256(utf8ToBytes(viewerId)))}`;

/**
 * Opens one connection and migrates the schema to the current version.
 *
 * The driver is passed in as an argument for testability (see the `sqlite.ts` header). The order
 * here (WAL, then foreign keys off, then migrate) runs **identically** on device and in tests.
 *
 * **Foreign keys are not enabled.** Sync treats a child arriving before its parent as normal,
 * because page boundaries are not ours to choose. With FKs on, that normal arrival would fail as a
 * constraint violation. SQLite's default is already off, but we state it explicitly. Relying on the
 * default means someone could switch it on one day, and the failure would appear only when two
 * devices meet.
 */
export async function openMobileDatabase(
	driver: SqliteDriver,
): Promise<MobileDatabase> {
	const db = createMobileDatabase(driver);
	/**
	 * WAL lets reads proceed without blocking writes. The app's steady state is the list screen and
	 * sync's `applyPull` running at the same time. On the default journal those two would wait on each
	 * other.
	 */
	await db.exec("PRAGMA journal_mode = WAL");
	await db.exec("PRAGMA foreign_keys = OFF");
	await migrate(db);
	return db;
}
