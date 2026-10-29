import type { ChatSeed } from "@rowcat/chat";
import { StoryChatSeedDto } from "@rowcat/contracts/chat";
import type { Viewer } from "@rowcat/domain";
import { VIEWER_QUERY_KEY } from "@rowcat/query";
import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthoringStore } from "#/lib/local-authoring/store.ts";
import { createChatStore } from "#/lib/local-chat/store.ts";
import { createDeviceKeyStore } from "#/lib/local-sync/device-key.ts";
import {
	createLocalDataActivation,
	type LocalDataDriver,
	type LocalDataStores,
} from "./activation.ts";
import {
	activateLocalDbScope,
	deleteLocalDbForViewer,
	type LocalDb,
	resetLocalDbScope,
} from "./db.ts";
import { purgeDeletedViewerLocally } from "./purge.ts";
import { type LocalDataScope, UNAVAILABLE_LOCAL_DATA_SCOPE } from "./scope.tsx";

/**
 * Local cleanup on member withdrawal, verified against real IndexedDB.
 *
 * Nothing checked here appears on screen. If the hook empties its list while the database stays,
 * the leftover data surfaces only when the next person uses the device. Deleting too much is worse:
 * another member's conversations in the same browser disappear, and that cannot be undone. So the
 * assertions check the stores' actual contents, not the hook's state.
 */

const seed = (): ChatSeed =>
	StoryChatSeedDto.parse({
		version: 1,
		storyId: "story-1",
		title: "Test story",
		adult: false,
		promptProtected: false,
	});

/**
 * Each test uses a different member code. Databases left by earlier tests are expected to remain
 * (logout does not delete them), so names must not collide in tests that verify deletion.
 */
let sequence = 0;
const nextViewer = (label: string): string => `${label}-${++sequence}`;

const openScope = (viewerId: string): LocalDb => activateLocalDbScope(viewerId);

/** Creates a room and returns the database. Deletion needs something to check against. */
async function seedRoom(viewerId: string): Promise<LocalDb> {
	const db = openScope(viewerId);
	await createChatStore(db).createRoom({
		originStoryId: "story-1",
		seed: seed(),
	});
	return db;
}

/** Asks IndexedDB directly, not a hook or cache, whether this member's database exists. */
async function databaseExists(viewerId: string): Promise<boolean> {
	const names = await indexedDB.databases();
	return names.some((entry) => entry.name === `rowcat_chat_${viewerId}`);
}

afterEach(() => {
	resetLocalDbScope();
});

describe("a deleted member's local database", () => {
	it("deletes one name only; other members on the same browser stay", async () => {
		const alice = nextViewer("alice");
		const bob = nextViewer("bob");
		await seedRoom(bob);
		resetLocalDbScope();
		await seedRoom(alice);

		await deleteLocalDbForViewer(alice);

		expect(await databaseExists(alice)).toBe(false);
		/**
		 * P0. If the delete predicate scans by the `rowcat_chat` prefix, Bob's conversations disappear
		 * too. That damage cannot be undone, and Bob would not know what he lost.
		 */
		expect(await databaseExists(bob)).toBe(true);
		const bobRooms = await createChatStore(openScope(bob)).listRooms();
		expect(bobRooms).toHaveLength(1);
	});

	/**
	 * Another member is open while the delete runs, and that connection is left alone. The
	 * account-switch path can actually run a retry (withdraw, sign in as another account, retry
	 * cleanup).
	 */
	it("does not close another member's open connection", async () => {
		const alice = nextViewer("alice");
		const bob = nextViewer("bob");
		await seedRoom(alice);
		resetLocalDbScope();
		const bobDb = await seedRoom(bob);

		await deleteLocalDbForViewer(alice);

		expect(bobDb.isOpen()).toBe(true);
		expect(await bobDb.rooms.count()).toBe(1);
	});

	/**
	 * The remembered device key lives inside each member's database (local-sync/device-key.ts).
	 * Deleting that database also deletes the key, so no global release function is needed. Such a
	 * function would let Alice's withdrawal revoke Bob's trust too.
	 */
	it("the remembered device key goes too, and other members' stay", async () => {
		const alice = nextViewer("alice");
		const bob = nextViewer("bob");
		const dek = new Uint8Array(32).fill(7);

		await createDeviceKeyStore(openScope(alice)).remember(dek);
		resetLocalDbScope();
		await createDeviceKeyStore(openScope(bob)).remember(dek);
		resetLocalDbScope();

		await deleteLocalDbForViewer(alice);

		// Deleted member: no database exists, so even a revived empty connection has no key.
		expect(await createDeviceKeyStore(openScope(alice)).recall()).toBeNull();
		resetLocalDbScope();
		expect(await createDeviceKeyStore(openScope(bob)).recall()).not.toBeNull();
	});
});

/**
 * Pins down the difference between two easily confused terms. One closes access, and the other
 * gives up ownership. The difference is one line of code, but for the user it is everything.
 */
describe("signing out and deleting differ", () => {
	it("signing out keeps data", async () => {
		const alice = nextViewer("alice");
		await seedRoom(alice);

		resetLocalDbScope();

		const rooms = await createChatStore(openScope(alice)).listRooms();
		expect(rooms).toHaveLength(1);
	});

	it("deleting keeps no data", async () => {
		const alice = nextViewer("alice");
		await seedRoom(alice);

		await deleteLocalDbForViewer(alice);

		/**
		 * Reopening under the same name yields an empty database. A later signup with the same method
		 * gets a different member id, so this name is not reused. The test does not rely on that and
		 * checks the contents instead.
		 */
		const rooms = await createChatStore(openScope(alice)).listRooms();
		expect(rooms).toEqual([]);
	});
});

describe("a late write does not revive a deleted database", () => {
	/**
	 * Some work is still running at withdrawal time: a generation that is finishing, a queued
	 * autosave, and hooks that clean up when the screen unmounts. These hold a reference to the old
	 * store instance. Dexie reopens a closed connection automatically on write by default, so a late
	 * write would revive the just-deleted name as an empty database. The device would then start
	 * collecting data for an account the user was told is gone.
	 */
	it("writes to the old chat store fail", async () => {
		const alice = nextViewer("alice");
		const db = openScope(alice);
		const staleStore = createChatStore(db);
		await staleStore.createRoom({ originStoryId: "story-1", seed: seed() });

		await deleteLocalDbForViewer(alice);

		await expect(
			staleStore.createRoom({ originStoryId: "story-2", seed: seed() }),
		).rejects.toThrow();
		expect(await databaseExists(alice)).toBe(false);
	});

	/** A pending draft autosave takes the same path, because it shares the connection. */
	it("a pending draft autosave fails", async () => {
		const alice = nextViewer("alice");
		const db = openScope(alice);
		const staleDrafts = createAuthoringStore(db);
		const draft = await staleDrafts.createDraft();

		await deleteLocalDbForViewer(alice);

		await expect(
			staleDrafts.updateDraft(draft.id, { title: "Late save" }),
		).rejects.toThrow();
		expect(await databaseExists(alice)).toBe(false);
	});
});

describe("a dropped member's scope does not reopen", () => {
	const stubStores = (viewerId: string): LocalDataStores =>
		({ chat: { viewerId } }) as unknown as LocalDataStores;

	function stubDriver() {
		const opened: string[] = [];
		const driver: LocalDataDriver = {
			open: (viewerId) => {
				opened.push(viewerId);
				return stubStores(viewerId);
			},
			reset: () => {},
		};
		return { driver, opened };
	}

	/**
	 * Deleting the database is not enough. A later ensure() call would open the same name again and
	 * recreate an empty database.
	 */
	it("an activation request after dropping does not open the store", async () => {
		const { driver, opened } = stubDriver();
		const activation = createLocalDataActivation({
			onOpen: () => {},
			load: async () => driver,
		});

		await activation.ensure("alice");
		activation.abandon("alice");

		expect(await activation.ensure("alice")).toBeNull();
		expect(opened).toEqual(["alice"]);
		// The owner is gone, so ownsStore returns false for every in-progress operation.
		expect(activation.owner()).toBeNull();
	});

	/** Only that one member is abandoned. Signing in as another account must not be blocked. */
	it("another member still opens", async () => {
		const { driver, opened } = stubDriver();
		const activation = createLocalDataActivation({
			onOpen: () => {},
			load: async () => driver,
		});

		activation.abandon("alice");
		expect(await activation.ensure("bob")).not.toBeNull();
		expect(opened).toEqual(["bob"]);
	});
});

/**
 * Pins down the order of cleanup. The three steps are discard the scope, delete the database, then
 * clear the query cache, and the order is what creates correctness.
 *
 * Swap the last two and the cache clear makes the viewer null first, so the scope drops to guest.
 * The deletion step then can no longer reach the open instance and can only delete by name. A late
 * write could then revive the database.
 */
describe("cleanup finishes in one go", () => {
	const fakeScope = (viewerId: string, abandonViewer: () => void) =>
		({
			...UNAVAILABLE_LOCAL_DATA_SCOPE,
			viewerId,
			abandonViewer,
		}) as LocalDataScope;

	it("drops the scope, deletes the database and clears private caches", async () => {
		const alice = nextViewer("alice");
		await seedRoom(alice);

		const abandonViewer = vi.fn();
		const cached: Viewer = {
			id: alice,
			nickname: "Alice",
			status: "approved",
			role: "user",
			verified: false,
			adult: false,
			showAdult: false,
			adultRecheckRequired: false,
			ageStatus: "standard",
			membershipGate: null,
		};
		const queryClient = new QueryClient();
		queryClient.setQueryData<Viewer | null>(VIEWER_QUERY_KEY, cached);

		await purgeDeletedViewerLocally({
			viewerId: alice,
			scope: fakeScope(alice, abandonViewer),
			queryClient,
		});

		expect(abandonViewer).toHaveBeenCalledWith(alice);
		expect(await databaseExists(alice)).toBe(false);
		// The deleted account's nickname and email must not stay on screen for even one more frame.
		expect(queryClient.getQueryData(VIEWER_QUERY_KEY)).toBeNull();
	});
});
