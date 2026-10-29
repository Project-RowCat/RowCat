import { mkdirSync, rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seed } from "../../test/fixtures.ts";
import {
	createMemorySecureStorage,
	createTempDirectory,
	createTestScopeController,
} from "../../test/sqlite-node.ts";
import type { LocalScopeController } from "./activation.ts";

/**
 * Abandoning a scope (`abandon`): locks the local boundary of account deletion by value.
 *
 * Two properties differ from `release()`, and they are the whole point of this file. Ownership is
 * revoked synchronously (before the first `await`), and reactivation of the same member is blocked
 * forever. If either breaks, the symptom is silent: a late write lands in a file being deleted, or
 * the deleted member's database reopens empty.
 */

const ALICE = "alice-viewer-id";
const BOB = "bob-viewer-id";

let temp: ReturnType<typeof createTempDirectory>;
let secure: ReturnType<typeof createMemorySecureStorage>;
let controller: LocalScopeController;

beforeEach(() => {
	temp = createTempDirectory();
	secure = createMemorySecureStorage();
	controller = createTestScopeController(temp.path, secure);
});

afterEach(async () => {
	await controller.release();
	temp.dispose();
});

/**
 * Where files are actually deleted. In the product this is `deleteLocalDataForViewer` (`purge.ts`).
 *
 * Here, emptying this test's directory stands in for that. The controller does not know what gets
 * deleted (the name and the key belong to that function), so this stand-in is enough. What is being
 * verified is **when** deletion happens.
 */
const erase = async (): Promise<void> => {
	rmSync(temp.path, { recursive: true, force: true });
	mkdirSync(temp.path, { recursive: true });
};

describe("ownership revocation", () => {
	it("current() is already empty before abandon returns", async () => {
		const alice = await controller.activate(ALICE);
		expect(controller.current()).toBe(alice);

		// Check immediately, without waiting. This synchronous step is the whole basis for blocking late
		// writes.
		const pending = controller.abandon(ALICE);
		expect(controller.current()).toBeNull();
		await pending;
	});

	it("the abandoned scope's store is closed", async () => {
		const alice = await controller.activate(ALICE);
		await controller.abandon(ALICE);
		await expect(alice.stores.chat.listRooms()).rejects.toThrow();
	});

	it("abandoning another member leaves the current scope as is", async () => {
		const bob = await controller.activate(BOB);
		await controller.abandon(ALICE);
		expect(controller.current()).toBe(bob);
		expect(await bob.stores.chat.listRooms()).toEqual([]);
	});
});

describe("no reactivation", () => {
	it("activate refuses an abandoned member — a deleted file doesn't revive", async () => {
		await controller.activate(ALICE);
		await controller.abandon(ALICE);
		await expect(controller.activate(ALICE)).rejects.toThrow();
		expect(controller.current()).toBeNull();
	});

	it("an activation abandoned while opening leaves no scope either", async () => {
		// Abandon after activation has started but before it finishes. This is a race between deletion
		// and opening.
		const opening = controller.activate(ALICE);
		const abandoning = controller.abandon(ALICE);
		await expect(opening).rejects.toThrow();
		await abandoning;
		expect(controller.current()).toBeNull();
	});

	it("another member activates as is", async () => {
		await controller.activate(ALICE);
		await controller.abandon(ALICE);
		const bob = await controller.activate(BOB);
		expect(controller.current()).toBe(bob);
	});
});

/**
 * **Local reset.** It deletes the same things as abandonment, with the opposite meaning.
 *
 * Getting this wrong has silent and expensive symptoms: a late activation during erasure brings the
 * file back, or after erasure the same member does not reopen, locking the user out of their own
 * account (a state only an app restart clears).
 */
describe("local reset", () => {
	it("ownership is already revoked before erase runs", async () => {
		const alice = await controller.activate(ALICE);
		expect(controller.current()).toBe(alice);

		// Check immediately, without waiting. This synchronous step is the whole basis for blocking late
		// writes.
		const pending = controller.resetViewer(ALICE, async () => {});
		expect(controller.current()).toBeNull();
		await pending;
	});

	// Deleting while open would leave the file handle behind, so closing must come before deletion.
	it("the old connection is already closed when erase runs", async () => {
		const alice = await controller.activate(ALICE);
		let closedBeforeErase = false;
		await controller.resetViewer(ALICE, async () => {
			closedBeforeErase = await alice.stores.chat
				.listRooms()
				.then(() => false)
				.catch(() => true);
		});
		expect(closedBeforeErase).toBe(true);
	});

	/**
	 * **A queued activation that was already waiting cannot bring back the file being deleted.** This
	 * check is the most valuable one in this group.
	 *
	 * The order that actually happens: an `ensureScope()` somewhere on screen is already queued when
	 * the user presses "erase data". Ownership was revoked synchronously, so that request has already
	 * lost its owner, but **in the queue it is still first**. If nothing stops it, it reopens the
	 * file, and the deletion that follows removes that file under a live connection.
	 *
	 * So the lock is also read inside `activate` (`resetting`).
	 */
	it("an activation queued earlier is refused", async () => {
		await controller.activate(ALICE);

		// Queue an activation. It has not run yet; the one above has already finished, so this one runs
		// next.
		let opened = false;
		const queued = controller
			.activate(ALICE)
			.then(() => {
				opened = true;
			})
			.catch(() => undefined);

		// Request the reset in the same tick. Revocation and locking both finish here.
		const reset = controller.resetViewer(ALICE, async () => {});

		await Promise.all([queued, reset]);
		expect(opened).toBe(false);
	});

	/**
	 * The opposite direction **waits rather than rejects**. An activation that arrives during deletion
	 * queues and opens after deletion finishes, and what it opens is a new empty database. That is the
	 * result this operation wants.
	 */
	it("an activation arriving during erasing opens after deletion", async () => {
		const before = await controller.activate(ALICE);
		await before.stores.chat.createRoom({
			originStoryId: null,
			seed: seed("A room to be erased"),
			title: "A room to be erased",
		});

		let during: Promise<unknown> | null = null;
		await controller.resetViewer(ALICE, async () => {
			during = controller.activate(ALICE);
			// No scope is open while deletion runs.
			expect(controller.current()).toBeNull();
			await erase();
		});

		await expect(during).resolves.toBeDefined();
		expect(await controller.current()?.stores.chat.listRooms()).toEqual([]);
	});

	/**
	 * **This is where it differs from abandon.** The account is still alive, so the same member must
	 * reopen immediately. If it did not, erasing data would also cost the user their account.
	 */
	it("the same member opens a new scope right away", async () => {
		const before = await controller.activate(ALICE);
		await before.stores.chat.createRoom({
			originStoryId: null,
			seed: seed("A room to be erased"),
			title: "A room to be erased",
		});

		await controller.resetViewer(ALICE, erase);

		const after = await controller.activate(ALICE);
		expect(await after.stores.chat.listRooms()).toEqual([]);
	});

	/**
	 * The lock is **temporary**. If it were merged into abandonment's permanent block list, entries
	 * would have to be removed after reset, and that removal would also weaken abandonment's
	 * permanence.
	 */
	it("the lock releases when the reset finishes", async () => {
		await controller.activate(ALICE);
		await controller.resetViewer(ALICE, async () => {});
		await expect(controller.activate(ALICE)).resolves.toBeDefined();
	});

	/**
	 * **The lock is released even if deletion fails.** Leaving it locked would cost someone whose
	 * erase failed their conversations too: the data is intact, but unreachable.
	 */
	it("even when erase throws the lock releases and the failure reaches the caller", async () => {
		await controller.activate(ALICE);
		await expect(
			controller.resetViewer(ALICE, async () => {
				throw new Error("couldn't delete the file");
			}),
		).rejects.toThrow("couldn't delete the file");

		await expect(controller.activate(ALICE)).resolves.toBeDefined();
	});

	// Other members' scopes are left alone. Never close someone else's connection by mistake.
	it("resetting another member leaves the current scope as is", async () => {
		const bob = await controller.activate(BOB);
		await controller.resetViewer(ALICE, async () => {});
		expect(controller.current()).toBe(bob);
		expect(await bob.stores.chat.listRooms()).toEqual([]);
	});

	/**
	 * **This is not the same as abandonment.** Reset does not permanently block reactivation, but an
	 * abandoned member still does not reopen after a reset.
	 */
	it("an abandoned member doesn't open even after a reset", async () => {
		await controller.activate(ALICE);
		await controller.abandon(ALICE);
		await controller.resetViewer(ALICE, async () => {});
		await expect(controller.activate(ALICE)).rejects.toThrow();
	});
});

describe("a different operation from signing out", () => {
	it("release doesn't block the same member's re-sign-in and the data stays", async () => {
		const first = await controller.activate(ALICE);
		await first.stores.chat.createRoom({
			originStoryId: null,
			seed: seed("A room from before signing out"),
			title: "A room from before signing out",
		});
		await controller.release();

		const again = await controller.activate(ALICE);
		expect((await again.stores.chat.listRooms()).map((r) => r.title)).toEqual([
			"A room from before signing out",
		]);
	});
});
