import { describe, expect, it } from "vitest";
import {
	startFailureMessage,
	startNavigateFailureMessage,
} from "./use-story-start.tsx";

/**
 * The wording of the `Start conversation` failure states. The branches are tested as values in
 * `start-story-chat.test.ts`; this test pins what the user sees. One branch was silent for a long
 * time: the room was created but navigation failed, and the screen showed no message while the room
 * existed only in the conversation list.
 */

describe("startNavigateFailureMessage()", () => {
	/**
	 * Retrying is not suggested: a retry would create another room for the same work, since the start
	 * path has no deduplication (explained in `start-story-chat.ts`). It is pinned as a value because
	 * it is where this message differs from the other failure messages.
	 */
	it("does not say to try again", () => {
		expect(startNavigateFailureMessage()).not.toMatch(/try again/i);
	});

	/**
	 * The message says where to continue instead: the created conversation is in the conversation
	 * list.
	 */
	it("says where the created conversation can be continued", () => {
		expect(startNavigateFailureMessage()).toMatch(/conversation list/);
	});

	/** The message must not read as a failed start, because the start succeeded. */
	it("does not read as a start failure", () => {
		expect(startNavigateFailureMessage()).not.toMatch(/couldn't start|failed/i);
		expect(
			(["play_unavailable", "storage", "unknown"] as const).map(
				startFailureMessage,
			),
		).not.toContain(startNavigateFailureMessage());
	});
});

describe("startFailureMessage", () => {
	/**
	 * The 404 is not explained. The server returns the same response for a missing work and one the
	 * viewer cannot see (private, blocked, adult gate). A specific reason would let anyone probe ids
	 * to learn whether someone else's private work exists.
	 */
	it("hides existence", () => {
		for (const message of (
			["play_unavailable", "storage", "unknown"] as const
		).map(startFailureMessage))
			expect(message).not.toMatch(
				/private|blocked|adult|does not exist|deleted/i,
			);
	});

	/** Implementation terms must not appear on screen; branch details go to the log. */
	it("carries no implementation terms", () => {
		for (const message of (
			["play_unavailable", "storage", "unknown"] as const
		).map(startFailureMessage))
			expect(message).not.toMatch(
				/store|scope|IndexedDB|Dexie|snapshot|payload/i,
			);
	});
});
