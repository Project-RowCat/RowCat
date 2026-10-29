import { existsSync } from "node:fs";
import { join } from "node:path";
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
import { deviceKeyEntry } from "./local-sync/device-key.ts";
import { purgeDeletedViewer } from "./purge-deleted-viewer.ts";

/**
 * Local cleanup on account deletion. This file is P0. It runs on real SQLite and checks that the
 * files to delete are actually gone, that Bob's files and keys survive, and that the order holds
 * (revoke ownership, delete files, reset private state). A mistake either deletes someone else's
 * data, which cannot be undone, or leaves the deleted account's values on screen.
 */

const ALICE = "alice-viewer-id";
const BOB = "bob-viewer-id";
const DEK_A = new Uint8Array(32).fill(7);
const DEK_B = new Uint8Array(32).fill(9);

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

/** Same assembly as the product wiring (`lib/account-deletion.ts`); only file deletion looks at this directory. */
const ports = (options?: { failDelete?: boolean }) => {
	const resets: number[] = [];
	const steps: string[] = [];
	return {
		steps,
		resets,
		build: {
			abandonViewer: (viewerId: string) => {
				steps.push(`abandon:${viewerId}`);
				return controller.abandon(viewerId);
			},
			deleteLocalData: (viewerId: string) => {
				steps.push(`delete:${viewerId}`);
				if (options?.failDelete) return Promise.reject(new Error("disk"));
				return deleteLocalDataForViewer(viewerId, {
					deleteDatabase: async (name) => {
						const { rmSync } = await import("node:fs");
						rmSync(join(temp.path, name), { force: true });
					},
					secureStorage: secure,
					/** Cover art is outside this harness's concern; calling it does nothing. */
					deleteDraftCovers: () => undefined,
				});
			},
			resetPrivateState: async () => {
				steps.push("reset");
				resets.push(1);
			},
		},
	};
};

async function seedBothAccounts() {
	const alice = await controller.activate(ALICE);
	await alice.stores.chat.createRoom({
		originStoryId: null,
		seed: seed("Alice's room"),
		title: "Alice's room",
	});
	await alice.stores.authoring.createDraft({ title: "Alice's manuscript" });
	await alice.stores.deviceKey.remember(DEK_A);

	const bob = await controller.activate(BOB);
	await bob.stores.chat.createRoom({
		originStoryId: null,
		seed: seed("Bob's room"),
		title: "Bob's room",
	});
	await bob.stores.authoring.createDraft({ title: "Bob's manuscript" });
	await bob.stores.deviceKey.remember(DEK_B);
	return { alice, bob };
}

const fileOf = (viewerId: string): string =>
	join(temp.path, viewerDatabaseName(viewerId));

describe("erases only the target member — multi-account isolation", () => {
	it("erasing Alice leaves Bob's file, content and key as they are", async () => {
		await seedBothAccounts();
		/** Deletion scenario: Alice is still active when the server deletion is confirmed. */
		await controller.activate(ALICE);

		const p = ports();
		await purgeDeletedViewer(ALICE, p.build);

		expect(existsSync(fileOf(ALICE))).toBe(false);
		expect(secure.entries().has(deviceKeyEntry(ALICE))).toBe(false);

		/** Bob's files, keys and contents are all unchanged. */
		expect(existsSync(fileOf(BOB))).toBe(true);
		expect(secure.entries().has(deviceKeyEntry(BOB))).toBe(true);
		const bob = await controller.activate(BOB);
		expect((await bob.stores.chat.listRooms()).map((r) => r.title)).toEqual([
			"Bob's room",
		]);
		expect(
			(await bob.stores.authoring.listDrafts()).map((d) => d.title),
		).toEqual(["Bob's manuscript"]);
		expect(await bob.stores.deviceKey.recall()).toEqual(DEK_B);
	});

	it("no prefix sweep — exactly one file is erased", async () => {
		await seedBothAccounts();
		await controller.activate(ALICE);
		await purgeDeletedViewer(ALICE, ports().build);
		expect(existsSync(fileOf(BOB))).toBe(true);
	});
});

describe("order", () => {
	it("the order is ownership revocation → physical deletion → cache reset", async () => {
		await controller.activate(ALICE);
		const p = ports();
		await purgeDeletedViewer(ALICE, p.build);
		expect(p.steps).toEqual([`abandon:${ALICE}`, `delete:${ALICE}`, "reset"]);
	});

	it("after ownership is revoked late writes fail", async () => {
		const alice = await controller.activate(ALICE);
		await purgeDeletedViewer(ALICE, ports().build);
		/** A late write to a store the screen still holds must not resurrect the deleted files. */
		await expect(
			alice.stores.chat.createRoom({
				originStoryId: null,
				seed: seed("A ghost's room"),
				title: "A ghost's room",
			}),
		).rejects.toThrow();
		expect(existsSync(fileOf(ALICE))).toBe(false);
	});

	it("reactivating a deleted member doesn't revive an empty database", async () => {
		await controller.activate(ALICE);
		await purgeDeletedViewer(ALICE, ports().build);
		await expect(controller.activate(ALICE)).rejects.toThrow();
		expect(existsSync(fileOf(ALICE))).toBe(false);
	});
});

describe("cleanup failure", () => {
	it("even when file deletion fails the private cache reset always runs", async () => {
		await controller.activate(ALICE);
		const p = ports({ failDelete: true });
		await expect(purgeDeletedViewer(ALICE, p.build)).rejects.toThrow("disk");
		/** Even on failure there is no reason for the deleted account's values to remain on screen. */
		expect(p.resets).toHaveLength(1);
	});
});

describe("sign-out regression — doesn't borrow deletion's destruction", () => {
	it("after release the file, key and content all remain and the same account comes back", async () => {
		await seedBothAccounts();
		await controller.activate(ALICE);
		await controller.release();

		/** Sign-out closes access; nothing is deleted. */
		expect(existsSync(fileOf(ALICE))).toBe(true);
		expect(secure.entries().has(deviceKeyEntry(ALICE))).toBe(true);

		const again = await controller.activate(ALICE);
		expect((await again.stores.chat.listRooms()).map((r) => r.title)).toEqual([
			"Alice's room",
		]);
		expect(await again.stores.deviceKey.recall()).toEqual(DEK_A);
	});
});
