import { describe, expect, test } from "vitest";
import {
	autoSyncToggleFailed,
	forgetDeviceFailed,
	recoveryRotateFailed,
} from "./sync-failure.ts";

/**
 * Locks the sync screen's failure messages to one fact: no data was lost. If a message here implied
 * otherwise, users would think their conversations were at risk. None of the three operations touch
 * local data, so no wording suggesting loss may appear.
 *
 * Checked against the source (English) dictionary; `lib/i18n/messages.test.ts` keeps the other
 * locales to the same keys.
 */

const messages = [
	autoSyncToggleFailed(),
	recoveryRotateFailed(),
	forgetDeviceFailed(),
];

describe("sync failure messages", () => {
	test("the three sentences differ", () => {
		expect(new Set(messages).size).toBe(messages.length);
	});

	/**
	 * The messages must not contain wording that suggests data was removed. All three operations
	 * change the server keyring or device preferences. Conversations and drafts are unchanged in every
	 * case.
	 */
	test.each(messages)("does not imply data loss: %s", (message) => {
		expect(message).not.toMatch(/delet|lost|loss|gone|reset|eras/i);
	});

	/** Protocol error codes are not shown, since users cannot do anything with them. */
	test.each(messages)("carries no error code: %s", (message) => {
		expect(message).not.toMatch(/[a-z]+_[a-z_]+/);
	});

	/**
	 * The rotation failure is the only one with an extra sentence. Without saying the old code still
	 * works, a user who reads 'could not get a new code' as 'the old code fails too' would discard the
	 * code they wrote down, and the account could never again be opened on another device.
	 */
	test("the rotation failure says the current code still works", () => {
		expect(recoveryRotateFailed()).toMatch(/current code still works/);
	});
});
