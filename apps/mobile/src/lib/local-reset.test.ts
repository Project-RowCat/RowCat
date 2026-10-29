import { existsSync } from "node:fs";
import { join } from "node:path";
import { EMPTY_GENERATION_PREFERENCE } from "@rowcat/chat";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seed } from "../test/fixtures.ts";
import {
	createMemorySecureStorage,
	createTempDirectory,
	createTestScopeController,
} from "../test/sqlite-node.ts";
import type { LocalScopeController } from "./local-data/activation.ts";
import { viewerDatabaseName } from "./local-data/database.ts";
import { deleteLocalDataForViewer } from "./local-data/purge.ts";
import { resetViewerLocalData } from "./local-reset.ts";
import { deviceKeyEntry } from "./local-sync/device-key.ts";

/**
 * Reset this device's data: one round trip on real SQLite.
 *
 * Three things this file actually defends against, all silent:
 *
 * ```text
 * a key that was not erased     a remembered DEK left behind makes "erased" a lie
 * another member's data erased  a deletion that sweeps by prefix takes other members on this device
 * an account that will not open the member cannot reopen after the reset, and the user loses the account
 * ```
 *
 * Not mocked: whether the file is really deleted is a question that can only be asked of a real
 * file (`isolation.test.ts` uses the same harness for the same reason).
 */

const ALICE = "alice-viewer-id";
const BOB = "bob-viewer-id";
const DEK = new Uint8Array(32).fill(7);

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

/** Same assembly as the product: neither the delete primitive nor the ordering takes a shortcut. */
const ports = () => ({
	resetScope: (viewerId: string, erase: () => Promise<void>) =>
		controller.resetViewer(viewerId, erase),
	deleteLocalData: (viewerId: string) =>
		deleteLocalDataForViewer(viewerId, {
			async deleteDatabase(name) {
				const { rmSync } = await import("node:fs");
				rmSync(join(temp.path, name), { force: true });
			},
			secureStorage: secure,
			/** Cover storage is not this harness's concern; it does nothing when called. */
			deleteDraftCovers: () => undefined,
		}),
});

/** Everything this member has stored on this device: conversations, messages, memories, personas, drafts, preferences and keys. */
async function seedViewer(viewerId: string, label: string): Promise<void> {
	const scope = await controller.activate(viewerId);
	const room = await scope.stores.chat.createRoom({
		originStoryId: null,
		seed: seed(`${label}'s room`),
		title: `${label}'s room`,
	});
	await scope.stores.chat.appendMessage({
		roomId: room.id,
		role: "user",
		content: `${label}'s message`,
	});
	await scope.stores.chat.createMemory({
		roomId: room.id,
		content: `${label}'s memory`,
	});
	await scope.stores.chat.createPersona({
		name: `${label}'s role`,
		description: "",
	});
	await scope.stores.authoring.createDraft({ title: `${label}'s manuscript` });
	await scope.stores.generation.setGlobal({
		...EMPTY_GENERATION_PREFERENCE,
		responseLength: "long",
	});
	await scope.stores.deviceKey.remember(DEK);
}

describe("what remains and what disappears after erasing", () => {
	it("this member's local records all disappear", async () => {
		await seedViewer(ALICE, "Alice");
		await resetViewerLocalData(ALICE, ports());

		const after = await controller.activate(ALICE);
		expect(await after.stores.chat.listRooms()).toEqual([]);
		expect(await after.stores.chat.listPersonas()).toEqual([]);
		expect(await after.stores.authoring.listDrafts()).toEqual([]);
		/** Device-generated preferences live inside that file too, which is why the list is not counted by hand. */
		expect(await after.stores.generation.getGlobal()).toEqual(
			EMPTY_GENERATION_PREFERENCE,
		);
	});

	/**
	 * **The remembered sync key goes too.** If it stays, the next empty database that opens downloads
	 * the old ciphertext right away and the user sees deleted conversations come back. That is the
	 * opposite of what this operation promises (the confirm dialog says "putting the key back in
	 * brings them back").
	 */
	it("the remembered sync key disappears", async () => {
		await seedViewer(ALICE, "Alice");
		expect(secure.entries().has(deviceKeyEntry(ALICE))).toBe(true);

		await resetViewerLocalData(ALICE, ports());

		expect(secure.entries().has(deviceKeyEntry(ALICE))).toBe(false);
		const after = await controller.activate(ALICE);
		expect(await after.stores.deviceKey.recall()).toBeNull();
	});

	it("the file itself is deleted", async () => {
		await seedViewer(ALICE, "Alice");
		const file = join(temp.path, viewerDatabaseName(ALICE));
		expect(existsSync(file)).toBe(true);

		await resetViewerLocalData(ALICE, ports());

		expect(existsSync(file)).toBe(false);
	});

	/**
	 * **The same member reopens immediately.** This is where it differs from deletion (`abandon`), and
	 * it is the whole reason this operation does not use that function. Using it would leave the
	 * account alive while the member's scope never reopens for the life of this process.
	 */
	it("the same member can open a new scope and write again", async () => {
		await seedViewer(ALICE, "Alice");
		await resetViewerLocalData(ALICE, ports());

		const after = await controller.activate(ALICE);
		await after.stores.chat.createRoom({
			originStoryId: null,
			seed: seed("A room after erasing"),
			title: "A room after erasing",
		});
		expect((await after.stores.chat.listRooms()).map((r) => r.title)).toEqual([
			"A room after erasing",
		]);
	});
});

describe("doesn't erase someone else's data", () => {
	/**
	 * This is where the rule "no prefix-sweeping delete (`rowcat_vnext_*`)" does its job. The only
	 * thing deleted is **one name**, and that name is derived deterministically from the member id.
	 */
	it("Bob's conversations, drafts, personas and key stay as they are", async () => {
		await seedViewer(BOB, "Bob");
		await seedViewer(ALICE, "Alice");

		await resetViewerLocalData(ALICE, ports());

		const bob = await controller.activate(BOB);
		expect((await bob.stores.chat.listRooms()).map((r) => r.title)).toEqual([
			"Bob's room",
		]);
		expect(
			(await bob.stores.authoring.listDrafts()).map((d) => d.title),
		).toEqual(["Bob's manuscript"]);
		expect((await bob.stores.chat.listPersonas()).map((p) => p.name)).toEqual([
			"Bob's role",
		]);
		expect(await bob.stores.deviceKey.recall()).not.toBeNull();
		expect(secure.entries().has(deviceKeyEntry(BOB))).toBe(true);
	});
});

describe("late writes don't leak into the new scope", () => {
	/**
	 * The real sequence: while a screen of Alice's holds a store reference and waits on an async
	 * operation, the user presses "reset local data". When that callback wakes up, the reference is a
	 * **closed connection to a deleted file**, not the new scope's.
	 *
	 * Ownership is checked by **instance**, not by member id. Comparing ids would give the same value
	 * before and after the reset, and this late write would pass.
	 */
	it("a store taken before the reset is no longer owned", async () => {
		await seedViewer(ALICE, "Alice");
		const stale = controller.current();
		expect(stale).not.toBeNull();

		await resetViewerLocalData(ALICE, ports());
		const fresh = await controller.activate(ALICE);

		/** Same member, different instance: the ownership predicate compares on this axis. */
		expect(fresh).not.toBe(stale);
		expect(controller.current()).toBe(fresh);
		expect(controller.current()).not.toBe(stale);

		/** Nothing gets written through that connection (it is already closed). */
		await expect(
			stale?.stores.chat.createRoom({
				originStoryId: null,
				seed: seed("A late room"),
				title: "A late room",
			}),
		).rejects.toThrow();
		expect(await fresh.stores.chat.listRooms()).toEqual([]);
	});
});

describe("no request goes out to the server", () => {
	/**
	 * This operation **finishes without a network.** Having only two ports is the structural form of
	 * that fact (scope lifetime and local deletion). There is no slot for account deletion, sign-out
	 * or query cache reset; those three are the wiring of deletion (`lib/purge-deleted-viewer.ts`).
	 */
	it("there are only two ports and only those two are called", async () => {
		const calls: string[] = [];
		await resetViewerLocalData(ALICE, {
			resetScope: async (viewerId, erase) => {
				calls.push(`resetScope:${viewerId}`);
				await erase();
			},
			deleteLocalData: async (viewerId) => {
				calls.push(`deleteLocalData:${viewerId}`);
			},
		});
		expect(calls).toEqual([`resetScope:${ALICE}`, `deleteLocalData:${ALICE}`]);
	});

	/** A failed deletion **throws**, so the confirm dialog receives it and the user retries. */
	it("when deletion fails the caller knows", async () => {
		await expect(
			resetViewerLocalData(ALICE, {
				resetScope: (_viewerId, erase) => erase(),
				deleteLocalData: () => Promise.reject(new Error("couldn't erase")),
			}),
		).rejects.toThrow("couldn't erase");
	});
});

describe("a second reset", () => {
	/**
	 * **The data-side half of a bug this slice fixed.**
	 *
	 * The screen-side half (the single-run lock not releasing after success) is guarded by
	 * `features/settings/local-reset-turn.test.ts`. What is checked here is that once that lock
	 * releases, **the controller actually accepts a second operation**. If only one side were fixed
	 * and this side stayed blocked, the user would still see nothing happen.
	 */
	it("the same controller can erase twice in a row", async () => {
		await seedViewer(ALICE, "Alice");
		const scopeA = controller.current();

		await resetViewerLocalData(ALICE, ports());
		const scopeB = await controller.activate(ALICE);

		/** Build up data again in the new scope, so the second reset has something to delete. */
		await scopeB.stores.chat.createRoom({
			originStoryId: null,
			seed: seed("Second room"),
			title: "Second room",
		});
		expect((await scopeB.stores.chat.listRooms()).length).toBe(1);

		await resetViewerLocalData(ALICE, ports());
		const scopeC = await controller.activate(ALICE);

		expect(await scopeC.stores.chat.listRooms()).toEqual([]);

		/**
		 * **All three instances differ.** This is the axis the screen's lock compares. Comparing by
		 * member id would give the same value for all three and protect nothing.
		 */
		expect(scopeB).not.toBe(scopeA);
		expect(scopeC).not.toBe(scopeB);
		expect(controller.current()).toBe(scopeC);
	});

	/** Nothing gets written through a past instance (both are already closed). */
	it("the two past scopes are no longer owned", async () => {
		await seedViewer(ALICE, "Alice");
		const scopeA = controller.current();
		await resetViewerLocalData(ALICE, ports());
		const scopeB = await controller.activate(ALICE);
		await resetViewerLocalData(ALICE, ports());
		const scopeC = await controller.activate(ALICE);

		expect(controller.current()).not.toBe(scopeA);
		expect(controller.current()).not.toBe(scopeB);
		expect(controller.current()).toBe(scopeC);
		for (const stale of [scopeA, scopeB])
			await expect(
				stale?.stores.chat.createRoom({
					originStoryId: null,
					seed: seed("A late room"),
					title: "A late room",
				}),
			).rejects.toThrow();
	});

	/**
	 * **Reset is not final.** The same member keeps opening after two resets. Had `abandon` been used,
	 * the first reset would already have locked the member out permanently, and the user would be
	 * locked out of their own account.
	 */
	it("even after two rounds the same member keeps opening", async () => {
		await seedViewer(ALICE, "Alice");
		await resetViewerLocalData(ALICE, ports());
		await resetViewerLocalData(ALICE, ports());
		await expect(controller.activate(ALICE)).resolves.toBeDefined();
	});
});
