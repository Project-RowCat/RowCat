import { describe, expect, it } from "vitest";
import type { LocalResetAwaiting } from "./local-reset-turn.ts";
import { localResetSettled } from "./local-reset-turn.ts";

/**
 * The single-run lifetime of a local reset: **when the lock is released.**
 *
 * This file exists because of a real defect in this slice: a successful reset never released the
 * lock, so someone who stayed on the same screen could not erase again. The quickest fix (`finally
 * { runningRef.current = false }`) is wrong in the other direction: the data is gone and the same
 * operation starts again in the window where no new scope exists yet.
 *
 * So the lock is released on an **observed fact**: this member now owns a scope of a **new
 * instance**.
 */

/** The scope instance at the start. Only references are compared, so its contents do not matter. */
const OLD = { id: "old" };
const FRESH = { id: "fresh" };

const awaiting: LocalResetAwaiting = {
	viewerId: "alice",
	previousScope: OLD,
};

describe("while the lock isn't released", () => {
	/**
	 * **The moment deletion finishes differs from the moment a new scope opens.** In between there is
	 * no data and no open connection; if a second reset arrives then, reactivation and the next
	 * deletion line up side by side in the controller's serial queue.
	 */
	it("reopening means not yet", () => {
		expect(
			localResetSettled(awaiting, {
				viewerId: "alice",
				status: "opening",
				scope: null,
			}),
		).toBe(false);
	});

	/** The state where the scope has not opened yet (just after closing) is the same. */
	it("no scope means not yet", () => {
		expect(
			localResetSettled(awaiting, {
				viewerId: "alice",
				status: "ready",
				scope: null,
			}),
		).toBe(false);
	});

	/**
	 * **P0.** If the old instance is back as it was, reactivation has not finished. Judging by member
	 * id would let this path pass, and the lock would then be released in a window with no data.
	 */
	it("the same instance unchanged means not yet", () => {
		expect(
			localResetSettled(awaiting, {
				viewerId: "alice",
				status: "ready",
				scope: OLD,
			}),
		).toBe(false);
	});
});

describe("three ways the lock releases", () => {
	/** **The normal path**: same member, different instance. */
	it("ends when a new instance opens", () => {
		expect(
			localResetSettled(awaiting, {
				viewerId: "alice",
				status: "ready",
				scope: FRESH,
			}),
		).toBe(true);
	});

	/**
	 * Could not reopen. Keeping the lock would kill this button permanently on a device where opening
	 * failed once, and only restarting the app would release it. Physical deletion is idempotent, so
	 * pressing again is safe.
	 */
	it("ends when it couldn't reopen", () => {
		expect(
			localResetSettled(awaiting, {
				viewerId: "alice",
				status: "error",
				scope: null,
			}),
		).toBe(true);
	});

	/** The account changed: this screen no longer owns that operation. */
	it("ends when the member changes", () => {
		expect(
			localResetSettled(awaiting, {
				viewerId: "bob",
				status: "ready",
				scope: FRESH,
			}),
		).toBe(true);
		expect(
			localResetSettled(awaiting, {
				viewerId: null,
				status: "idle",
				scope: null,
			}),
		).toBe(true);
	});
});

describe("a second reset", () => {
	/**
	 * **This is the original defect this file guards against.** Success → new scope → lockable again →
	 * a second success. It does not rely on the component remounting: someone who stayed on the same
	 * screen must be able to erase again.
	 */
	it("after the first reset finishes, the second runs by the same rule", () => {
		const first: LocalResetAwaiting = {
			viewerId: "alice",
			previousScope: OLD,
		};
		/** The first operation finishes. */
		expect(
			localResetSettled(first, {
				viewerId: "alice",
				status: "ready",
				scope: FRESH,
			}),
		).toBe(true);

		/** The second one captures **the instance at that time**. */
		const second: LocalResetAwaiting = {
			viewerId: "alice",
			previousScope: FRESH,
		};
		/** Still that instance means not finished: the first operation's result is not reused. */
		expect(
			localResetSettled(second, {
				viewerId: "alice",
				status: "ready",
				scope: FRESH,
			}),
		).toBe(false);

		const third = { id: "third" };
		expect(
			localResetSettled(second, {
				viewerId: "alice",
				status: "ready",
				scope: third,
			}),
		).toBe(true);
	});
});

describe("when there was no scope at the start", () => {
	/**
	 * A reset can be pressed even when opening has failed (erasure acts on the name, so it needs no
	 * open connection). There is no old instance to compare with then, so the operation ends once any
	 * new instance opens.
	 */
	const fromNothing: LocalResetAwaiting = {
		viewerId: "alice",
		previousScope: null,
	};

	it("waits while nothing has opened yet", () => {
		expect(
			localResetSettled(fromNothing, {
				viewerId: "alice",
				status: "opening",
				scope: null,
			}),
		).toBe(false);
	});

	it("ends when the scope opens", () => {
		expect(
			localResetSettled(fromNothing, {
				viewerId: "alice",
				status: "ready",
				scope: FRESH,
			}),
		).toBe(true);
	});
});
