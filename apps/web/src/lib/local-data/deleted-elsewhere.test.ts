import { afterEach, expect, it } from "vitest";
import {
	activateLocalDbScope,
	activeLocalDbScope,
	LocalDb,
	resetLocalDbScope,
	setLocalDbDeletedElsewhereHandler,
} from "./db.ts";

/**
 * Another tab of the same member erases this device's data, or withdraws the account. That tab
 * deletes the database through its own connection; this one only receives `versionchange`. Dexie's
 * default closes with auto-open left on, so this tab's next read or write recreated the database
 * under the deleted name — after an erase, a trusted tab then pulled everything back as plaintext.
 */

let restore: (() => void) | null = null;
afterEach(() => {
	restore?.();
	restore = null;
	resetLocalDbScope();
});

it("**a database another tab deleted stays deleted, and this tab starts over**", async () => {
	const reloaded: string[] = [];
	restore = setLocalDbDeletedElsewhereHandler((viewerId) =>
		reloaded.push(viewerId),
	);
	const thisTab = activateLocalDbScope("deleted-elsewhere-alice");
	await thisTab.syncState.toArray();

	// The other tab: its own connection to the same name.
	await new LocalDb(thisTab.name).delete({ disableAutoOpen: true });

	expect(reloaded).toEqual(["deleted-elsewhere-alice"]);
	expect(activeLocalDbScope()).toBeNull();
	// A late write in this tab fails instead of recreating the database.
	await expect(thisTab.syncState.toArray()).rejects.toThrow();
	const names = (await indexedDB.databases()).map((db) => db.name);
	expect(names).not.toContain(thisTab.name);
});
