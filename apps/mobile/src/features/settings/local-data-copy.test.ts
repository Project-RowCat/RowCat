import { describe, expect, it } from "vitest";
import {
	LOCAL_DATA_AFTER_NOTE,
	LOCAL_DATA_CONFIRM_DESCRIPTION,
	LOCAL_DATA_CONFIRM_TITLE,
	LOCAL_DATA_FAILURE_MESSAGE,
	LOCAL_DATA_KEPT,
	LOCAL_DATA_REMOVED,
	LOCAL_DATA_SYNC_NOTE,
} from "./local-data-copy.ts";

/**
 * Locks the **facts** the reset confirmation states: the claims, not each sentence.
 *
 * A mistake here means the user makes an irreversible decision on wrong information. Two directions
 * are easy to get wrong, and both come from copying web wording:
 *
 * ```text
 * claims something absent from this app   browser · saved API key · legacy RowCat import
 * promises what cannot be kept            "permanently deleted from the server"
 * ```
 */

const ALL = [
	LOCAL_DATA_CONFIRM_TITLE,
	LOCAL_DATA_CONFIRM_DESCRIPTION,
	LOCAL_DATA_REMOVED,
	LOCAL_DATA_KEPT,
	LOCAL_DATA_SYNC_NOTE,
	LOCAL_DATA_AFTER_NOTE,
].join("\n");

describe("what disappears", () => {
	it("lists what's actually on this device", () => {
		for (const item of [
			"Conversations",
			"memories",
			"personas",
			"drafts",
			"generation settings",
			"sync key",
		])
			expect(LOCAL_DATA_REMOVED, item).toContain(item);
	});

	/**
	 * **The provider API key is also local data on this device.**
	 *
	 * This assertion is the most recent addition to this file, because the fact changed: until
	 * personal API key connections existed, the copy correctly did not mention it. If it is dropped,
	 * the dialog becomes false: users read that only conversations and drafts are erased, while the
	 * connected key is lost too (`lib/local-data/purge.ts` actually deletes it).
	 */
	it("lists the connected provider API keys", () => {
		expect(LOCAL_DATA_REMOVED).toContain("API key");
		expect(LOCAL_DATA_REMOVED).toContain("provider");
	});

	/**
	 * **Do not claim this app erases things it does not have.** The browser is a web concept, and the
	 * legacy RowCat data import no longer exists in any app.
	 */
	it("doesn't mention what this app doesn't have", () => {
		for (const absent of ["browser", "tab", "old RowCat", "migration"])
			expect(ALL, absent).not.toContain(absent);
	});
});

describe("what remains", () => {
	it("says the account, stories and other devices remain", () => {
		for (const item of ["account", "stories", "other devices"])
			expect(LOCAL_DATA_KEPT, item).toContain(item);
	});

	/**
	 * **Do not say the provider account's key is discarded.** We are not the owner of that account,
	 * and someone who presses believing otherwise thinks they did something irreversible; in fact one
	 * local copy disappeared.
	 */
	it("says the provider account's key stays", () => {
		expect(LOCAL_DATA_KEPT).toContain("aren't revoked");
	});

	/** Neither logout nor account deletion: after erasing, the same account keeps using the app. */
	it("says you stay signed in", () => {
		expect(LOCAL_DATA_AFTER_NOTE).toContain("you stay signed in");
	});
});

describe("the way back", () => {
	/**
	 * The server's ciphertext is not something this operation knows about. If that is not said, a
	 * person who re-entered the key and had the copy come back down will read the erase as having
	 * **failed**.
	 */
	it("states that an encrypted copy remains", () => {
		expect(LOCAL_DATA_SYNC_NOTE).toContain("encrypted copy");
		expect(LOCAL_DATA_SYNC_NOTE).toContain("comes back down");
	});

	/** **Do not make a promise that cannot be kept.** */
	it("doesn't say it's permanently deleted on the server", () => {
		for (const claim of [
			"permanently",
			"completely deleted",
			"deleted from the server",
			"every device",
		])
			expect(ALL, claim).not.toContain(claim);
	});
});

describe("failure", () => {
	/** The raw storage error is not drawn; only the one thing the user can do is stated. */
	it("carries no internal error names", () => {
		expect(LOCAL_DATA_FAILURE_MESSAGE).toContain("try again");
		for (const internal of ["SQLite", "Keychain", "SecureStore", "Error"])
			expect(LOCAL_DATA_FAILURE_MESSAGE, internal).not.toContain(internal);
	});
});
