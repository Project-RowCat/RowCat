import { describe, expect, test } from "vitest";
import {
	draftCreateFailureMessage,
	draftDeleteFailureMessage,
	draftStructureFailureMessage,
} from "./failure.ts";

/**
 * Locks the sentences themselves. These three are the only text the user reads when a failure
 * happens.
 *
 * Checking them as values is the point of this file. Without that, finding out what a failed
 * structure change says would require actually making IndexedDB fail.
 */

const messages = [
	draftStructureFailureMessage(),
	draftCreateFailureMessage(),
	draftDeleteFailureMessage(),
];

describe("draft failure messages", () => {
	test("the three sentences differ", () => {
		expect(new Set(messages).size).toBe(messages.length);
	});

	/**
	 * Implementation vocabulary must not leak into the messages. Dexie, IndexedDB and QuotaExceeded
	 * say nothing the user can act on and only cause alarm; those causes are logged instead.
	 */
	test.each(messages)("carries no implementation terms: %s", (message) => {
		expect(message).not.toMatch(
			/Dexie|IndexedDB|Quota|Error|store|transaction/i,
		);
	});

	/**
	 * A failed draft delete must not suggest data loss. The delete is irreversible, and the message
	 * should not add alarm on top of that.
	 */
	test("a failed draft delete does not imply data loss", () => {
		expect(draftDeleteFailureMessage()).not.toMatch(
			/was deleted|is gone|lost/i,
		);
	});

	/**
	 * All three messages point to the next step, which here is only to press the action again: `Try again`.
	 */
	test.each(messages)("says try again: %s", (message) => {
		expect(message).toMatch(/try again/i);
	});
});
