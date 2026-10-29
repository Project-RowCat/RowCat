import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seed } from "../../test/fixtures.ts";
import {
	createMemorySecureStorage,
	createTempDirectory,
	createTestScopeController,
} from "../../test/sqlite-node.ts";
import { deviceKeyEntry } from "../local-sync/device-key.ts";
import type { LocalScopeController } from "./activation.ts";
import { viewerDatabaseName } from "./database.ts";
import { deleteLocalDataForViewer } from "./purge.ts";

/**
 * Account isolation. **This is the P0 file.**
 *
 * If Alice's conversations show up on Bob's screen, or a DEK Alice remembered opens under Bob's
 * scope, that is an incident, not a minor bug. The legacy app started with one store shared by all
 * members and ran into exactly this. Here the isolation comes from the structure itself: separate
 * **files and key names**, not a member filter on every query (such a filter goes unnoticed when
 * even one query omits it).
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

const DEK = new Uint8Array(32).fill(7);

describe("file name", () => {
	it("differs per member, and the same member is always the same", () => {
		expect(viewerDatabaseName(ALICE)).not.toBe(viewerDatabaseName(BOB));
		expect(viewerDatabaseName(ALICE)).toBe(viewerDatabaseName(ALICE));
	});

	it("doesn't write the member identifier in the file name as plain text", () => {
		expect(viewerDatabaseName(ALICE)).not.toContain(ALICE);
		expect(viewerDatabaseName(ALICE)).toMatch(
			/^rowcat_vnext_[0-9a-f]{64}\.db$/,
		);
	});
});

describe("Alice → Bob", () => {
	it("Bob's scope has neither Alice's conversations nor drafts", async () => {
		const alice = await controller.activate(ALICE);
		const room = await alice.stores.chat.createRoom({
			originStoryId: null,
			seed: seed("Alice's room"),
			title: "Alice's room",
		});
		const draft = await alice.stores.authoring.createDraft({
			title: "Alice's manuscript",
		});
		await alice.stores.deviceKey.remember(DEK);

		const bob = await controller.activate(BOB);

		expect(await bob.stores.chat.listRooms()).toEqual([]);
		expect(await bob.stores.authoring.listDrafts()).toEqual([]);
		expect(await bob.stores.chat.getRoom(room.id)).toBeNull();
		expect(await bob.stores.authoring.getDraft(draft.id)).toBeNull();
		// **The key does not cross over either.** If it did, stealing a session would also steal the
		// data.
		expect(await bob.stores.deviceKey.recall()).toBeNull();
	});

	it("coming back as Alice opens the same file", async () => {
		const alice = await controller.activate(ALICE);
		const room = await alice.stores.chat.createRoom({
			originStoryId: null,
			seed: seed("Alice's room"),
			title: "Alice's room",
		});
		await alice.stores.authoring.createDraft({ title: "Alice's manuscript" });
		await alice.stores.deviceKey.remember(DEK);

		await controller.activate(BOB);
		const again = await controller.activate(ALICE);

		expect((await again.stores.chat.getRoom(room.id))?.title).toBe(
			"Alice's room",
		);
		expect(
			(await again.stores.authoring.listDrafts()).map((d) => d.title),
		).toEqual(["Alice's manuscript"]);
		expect(await again.stores.deviceKey.recall()).toEqual(DEK);
	});

	it("the device identifier is attached to the file — the same on reopen, different between members", async () => {
		const alice = await controller.activate(ALICE);
		const aliceDevice = (await alice.stores.sync.readState()).deviceId;
		const bob = await controller.activate(BOB);
		const bobDevice = (await bob.stores.sync.readState()).deviceId;
		const again = await controller.activate(ALICE);

		expect((await again.stores.sync.readState()).deviceId).toBe(aliceDevice);
		expect(bobDevice).not.toBe(aliceDevice);
	});
});

describe("scope lifetime", () => {
	it("reactivating the same member is the same instance", async () => {
		const first = await controller.activate(ALICE);
		expect(await controller.activate(ALICE)).toBe(first);
	});

	it("switching members closes the previous connection", async () => {
		const alice = await controller.activate(ALICE);
		await controller.activate(BOB);

		/**
		 * A closed adapter must not quietly come back to life. If a screen left mounted after sign-out
		 * writes through the store it is still holding, that write lands in **the previous member's
		 * file**.
		 */
		await expect(alice.stores.chat.listRooms()).rejects.toThrow();
	});

	it("signing out releases the connection, and signing in again opens a new one", async () => {
		const first = await controller.activate(ALICE);
		await controller.release();
		expect(controller.current()).toBeNull();

		const second = await controller.activate(ALICE);
		expect(second).not.toBe(first);
		expect(second.db).not.toBe(first.db);
		// The data is unchanged: sign-out closes access, it does not erase anything.
		expect(await second.stores.chat.listRooms()).toEqual([]);
	});
});

/**
 * **Account security does not touch local ownership.**
 *
 * Changing the email, password, linked providers, passkeys or sessions leaves the RowCat member
 * identity (`Viewer.id`) unchanged. If that identity ever shifted, the symptom would not be an
 * error but conversations and drafts appearing to vanish entirely, with no way to recover them; a
 * new file would simply be created.
 *
 * This guarantee exists only as the absence of a condition in the code, so it is checked by value:
 * the file name is a function of **`Viewer.id` alone**, and the auth account identity (Better Auth
 * `user.id`), the email and the login method have no place in that computation.
 */
describe("account security and file identity", () => {
	it("the file name comes only from the member id", () => {
		/**
		 * The same member always gets the same name, whatever changed in between (email change, password
		 * set, Google linked). This function has one input, so its answer cannot differ.
		 */
		expect(viewerDatabaseName(ALICE)).toBe(viewerDatabaseName(ALICE));
		/** Passing the auth account identity would open **a different file**, so it is not passed. */
		expect(viewerDatabaseName("better-auth-user-id")).not.toBe(
			viewerDatabaseName(ALICE),
		);
	});

	/**
	 * After a security action the session may refresh, closing and reopening the scope once (a
	 * password change or linked method rewrites the cookie). Even then, **the same member maps to the
	 * same file**, so conversations and drafts must still be there.
	 */
	it("with a new session but the same member, conversations and drafts stay", async () => {
		const before = await controller.activate(ALICE);
		const room = await before.stores.chat.createRoom({
			originStoryId: null,
			seed: seed("A room from before security"),
			title: "A room from before security",
		});
		await before.stores.authoring.createDraft({
			title: "A manuscript from before security",
		});
		await before.stores.deviceKey.remember(DEK);
		const deviceId = (await before.stores.sync.readState()).deviceId;

		/** The auth side swapped the session; the member id is unchanged. */
		await controller.release();
		const after = await controller.activate(ALICE);

		expect(after).not.toBe(before);
		expect((await after.stores.chat.getRoom(room.id))?.title).toBe(
			"A room from before security",
		);
		expect(
			(await after.stores.authoring.listDrafts()).map((d) => d.title),
		).toEqual(["A manuscript from before security"]);
		/** The remembered DEK is unchanged too: security actions do not revoke sync trust. */
		expect(await after.stores.deviceKey.recall()).toEqual(DEK);
		/** The device id is attached to the file, so it is unchanged as well. */
		expect((await after.stores.sync.readState()).deviceId).toBe(deviceId);
	});

	/** The reverse direction is also pinned by value: **a different member id means a different store**. */
	it("a different member id opens a different store", async () => {
		const alice = await controller.activate(ALICE);
		await alice.stores.chat.createRoom({
			originStoryId: null,
			seed: seed("Alice's room"),
			title: "Alice's room",
		});

		const bob = await controller.activate(BOB);
		expect(await bob.stores.chat.listRooms()).toEqual([]);
	});
});

describe("local deletion", () => {
	it("deletes only this member's file and key", async () => {
		const alice = await controller.activate(ALICE);
		await alice.stores.deviceKey.remember(DEK);
		const bob = await controller.activate(BOB);
		await bob.stores.deviceKey.remember(DEK);
		await controller.release();

		const deleted: string[] = [];
		await deleteLocalDataForViewer(ALICE, {
			deleteDatabase: async (name) => {
				deleted.push(name);
			},
			secureStorage: secure,
			/** The cover slot is not this harness's concern; calling it does nothing. */
			deleteDraftCovers: () => undefined,
		});

		expect(deleted).toEqual([viewerDatabaseName(ALICE)]);
		expect(secure.entries().has(deviceKeyEntry(ALICE))).toBe(false);
		// Bob's trust remains: Alice's departure must not unlock Bob's key.
		expect(secure.entries().has(deviceKeyEntry(BOB))).toBe(true);
	});
});
