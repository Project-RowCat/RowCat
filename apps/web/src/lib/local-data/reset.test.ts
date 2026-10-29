import type { ChatSeed } from "@rowcat/chat";
import { StoryChatSeedDto } from "@rowcat/contracts/chat";
import { afterEach, describe, expect, it } from "vitest";
import { createChatStore } from "#/lib/local-chat/store.ts";
import { activateLocalDbScope, type LocalDb, resetLocalDbScope } from "./db.ts";
import { resetLocalDataForViewer } from "./reset.ts";

/**
 * Erase this device's data, verified against real IndexedDB. Three things checked here are all
 * invisible on screen:
 * - the data is actually deleted (a hook can empty its list while the database remains),
 * - other members' data is untouched (this operation should not know about them),
 * - the deleted name is not revived.
 */

let sequence = 0;
const nextViewer = (label: string): string => `${label}-${++sequence}`;

const seed = (): ChatSeed =>
	StoryChatSeedDto.parse({
		version: 1,
		storyId: "story-1",
		title: "Test story",
		adult: false,
		promptProtected: false,
	});

async function seedRoom(viewerId: string): Promise<LocalDb> {
	const db = activateLocalDbScope(viewerId);
	await createChatStore(db).createRoom({
		originStoryId: "story-1",
		seed: seed(),
	});
	return db;
}

async function databaseExists(name: string): Promise<boolean> {
	const names = await indexedDB.databases();
	return names.some((entry) => entry.name === name);
}

/**
 * Goes through the same path the product uses; only the reload is stubbed. Calling the storage
 * function directly would verify only that erase erases, and skip the line in reset.ts that the
 * screen actually runs.
 */
const wipe = (viewerId: string): Promise<void> =>
	resetLocalDataForViewer({ viewerId, reload: () => {} });

afterEach(() => {
	resetLocalDbScope();
});

describe("clearing this device's data", () => {
	it("this member's conversations are gone", async () => {
		const viewer = nextViewer("alice");
		await seedRoom(viewer);

		await wipe(viewer);

		resetLocalDbScope();
		expect(
			await createChatStore(activateLocalDbScope(viewer)).listRooms(),
		).toEqual([]);
	});

	/**
	 * P0. A prefix predicate (`rowcat_chat`) would delete Bob's conversations along with Alice's, and
	 * Bob would not know what he lost. Reset and withdrawal share one function, but this action is
	 * pressed far more often (it sits on an ordinary settings screen), so the assertion is repeated
	 * here.
	 */
	it("other members on the same browser stay", async () => {
		const alice = nextViewer("alice");
		const bob = nextViewer("bob");
		await seedRoom(bob);
		resetLocalDbScope();
		await seedRoom(alice);

		await wipe(alice);

		resetLocalDbScope();
		expect(
			await createChatStore(activateLocalDbScope(bob)).listRooms(),
		).toHaveLength(1);
	});

	/**
	 * Do not revive the name. Creating an empty database after deletion would turn the operation into
	 * "keep the name, empty the contents." The next activation creates the same name anyway, so the
	 * result would match, but a logged-out browser would keep a name that no one opens.
	 */
	it("does not revive the deleted name", async () => {
		const viewer = nextViewer("alice");
		await seedRoom(viewer);

		await wipe(viewer);

		expect(await databaseExists(`rowcat_chat_${viewer}`)).toBe(false);
	});
});

describe("rebuilds the app after clearing", () => {
	/**
	 * Reload is part of the operation, not a visual extra. Once deleted, the store instance the screen
	 * holds is permanently dead (disableAutoOpen). Subscriptions and pending writes still reference
	 * it. Without rebuilding, the user would see an app that cannot read anything.
	 */
	it("reloads the app after clearing", async () => {
		const viewer = nextViewer("alice");
		await seedRoom(viewer);
		let reloads = 0;

		await resetLocalDataForViewer({
			viewerId: viewer,
			reload: () => {
				reloads += 1;
			},
		});

		expect(reloads).toBe(1);
		expect(await databaseExists(`rowcat_chat_${viewer}`)).toBe(false);
	});
});
