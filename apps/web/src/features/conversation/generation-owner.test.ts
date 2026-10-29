import type { ChatStore } from "@rowcat/chat";
import { describe, expect, it } from "vitest";
import {
	canPersistGeneration,
	type GenerationOwner,
	ownsHistory,
	ownsSession,
	releaseOwnSlot,
} from "./generation-owner.ts";

/**
 * Generation ownership tests.
 *
 * Everything that breaks here breaks silently. If the rule is too loose, a logged-out account's
 * response gets written into the currently open database (the screen only gains someone else's
 * conversation). If it is too tight, a perfectly good generation is cut off on every re-render, and
 * to the user it only looks like "answers sometimes never arrive."
 *
 * The store is not actually opened. This judgment is an **identity comparison** and has nothing to
 * do with IndexedDB. Plugging in real Dexie would bury the rule under storage behavior
 * (store.test.ts covers that side).
 */

/**
 * Markers for creating distinct conversation instances. Their methods are never called.
 *
 * Local room tokens are store instances, so the fake uses that type, but the check itself looks
 * only at an **opaque reference**. The story test's playback session object goes through the same
 * rule.
 */
const storeOf = (label: string): ChatStore =>
	({ label }) as unknown as ChatStore;

const aliceStore = storeOf("alice");
const bobStore = storeOf("bob");

const owner: GenerationOwner = {
	viewerId: "alice",
	session: aliceStore,
	historyEpoch: 0,
};

describe("ownsSession", () => {
	it("the same member's same conversation is its own", () => {
		expect(ownsSession(owner, { viewerId: "alice", session: aliceStore })).toBe(
			true,
		);
	});

	it("React recreating the key object alone does not change ownership", () => {
		/**
		 * Comparing by reference would return false here, and one re-render would cut off an in-flight
		 * generation. What must be compared is the **semantic owner**, not the object.
		 */
		const rerendered = { ...{ viewerId: "alice", session: aliceStore } };
		expect(ownsSession(owner, rerendered)).toBe(true);
	});

	it("signing out cuts ownership", () => {
		// Guest state: there is no usable store at all.
		expect(ownsSession(owner, { viewerId: null, session: null })).toBe(false);
	});

	it("switching accounts cuts ownership", () => {
		expect(ownsSession(owner, { viewerId: "bob", session: bobStore })).toBe(
			false,
		);
	});

	it("there is no ownership mid-switch (still opening) either", () => {
		/**
		 * There is a real render where the switch to Bob has happened but his database is still opening.
		 * Alice's generation must not pass through that gap by reasoning "no store, so it must be mine".
		 */
		expect(ownsSession(owner, { viewerId: "bob", session: null })).toBe(false);
	});

	it("even for the same member, a reopened connection makes the old instance a stranger", () => {
		/**
		 * The path is `Alice → guest → Alice`. Comparing only the member id would return true here, and
		 * writes would go out to a connection that is already closed. They are rejected (the whole
		 * cleanup is lost) or silently dropped.
		 */
		const reopened = storeOf("alice-2");
		expect(ownsSession(owner, { viewerId: "alice", session: reopened })).toBe(
			false,
		);
	});
});

describe("releaseOwnSlot", () => {
	it("releases only my own controller", () => {
		const mine = new AbortController();
		expect(releaseOwnSlot<AbortController>(mine, mine)).toBeNull();
	});

	it("does not touch the slot once the next generation took it", () => {
		/**
		 * Without this check, the cleanup of an earlier generation that finishes late would clear the
		 * abort handle of the generation that just started. After that, the stop button would press
		 * without cutting anything, and the user would wait for the model to finish.
		 */
		const mine = new AbortController();
		const next = new AbortController();
		expect(releaseOwnSlot(next, mine)).toBe(next);
	});

	it("leaves an empty slot empty", () => {
		expect(releaseOwnSlot(null, new AbortController())).toBeNull();
	});
});

/**
 * **P0.** If history was rewritten after a generation started, that generation cannot reach a save
 * by any path.
 *
 * This axis exists separately because an abort signal alone cannot stop it. `abort()` is only a
 * signal: a request that has already received its full body ignores it and ends **normally**. Its
 * confirming save arrives as a success, not a failure, so code that checks for abort lets it
 * through.
 */
describe("ownsHistory", () => {
	it("can save when the epoch is the one it started with", () => {
		expect(ownsHistory(owner, 0)).toBe(true);
	});

	it("cannot save once the tail was rewritten", () => {
		expect(ownsHistory(owner, 1)).toBe(false);
	});

	it("the same after several rewrites — no epoch comes back", () => {
		expect(ownsHistory({ ...owner, historyEpoch: 2 }, 5)).toBe(false);
	});
});

describe("canPersistGeneration", () => {
	const key = { viewerId: "alice", session: aliceStore };

	it("true only when both conversation and history are unchanged", () => {
		expect(canPersistGeneration(owner, key, 0)).toBe(true);
	});

	/**
	 * The two axes are checked separately. These two cases exist so that an implementation looking at
	 * only one axis fails. Checking only conversation identity lets a reply attach to a just-deleted
	 * conversation, and checking only history sends a logged-out account's response into the next
	 * person's database.
	 */
	it("false when the conversation is the same but history changed", () => {
		expect(canPersistGeneration(owner, key, 1)).toBe(false);
	});

	it("false when history is the same but the account changed", () => {
		expect(
			canPersistGeneration(owner, { viewerId: "bob", session: bobStore }, 0),
		).toBe(false);
	});
});
