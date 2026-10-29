import { type ChatStore, EMPTY_GENERATION_PREFERENCE } from "@rowcat/chat";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
	LocalScopeController,
	MobileLocalScope,
} from "../../../lib/local-data/activation.ts";
import { seed } from "../../../test/fixtures.ts";
import {
	createMemorySecureStorage,
	createTempDirectory,
	createTestScopeController,
} from "../../../test/sqlite-node.ts";
import {
	deleteManagedRoom,
	type RoomMutationScope,
	renameManagedRoom,
} from "./mutations.ts";

/**
 * Room management over an arbitrary room, on real SQLite. Management used to target only the
 * currently open room (its header was the only entry), so "delete another room" did not exist as a
 * path; the conversation list made it normal, since a row renames and deletes rooms that are not
 * open. Screens are not rendered, as in the app's other tests (`vitest.config.ts`); the rules live
 * in a pure composition outside the hook (`mutations.ts`) and run here against the store, leaving
 * only state and window in the hook.
 */

let temp: ReturnType<typeof createTempDirectory>;
let controller: LocalScopeController;
let alice: MobileLocalScope;

beforeEach(async () => {
	temp = createTempDirectory();
	controller = createTestScopeController(
		temp.path,
		createMemorySecureStorage(),
	);
	alice = await controller.activate("alice");
});

afterEach(async () => {
	await controller.release();
	temp.dispose();
});

/** The scope the controller currently holds is the owner; same decision as the screen's `ownsStore`. */
const scopeOf = (owner: MobileLocalScope): RoomMutationScope => ({
	store: owner.stores.chat,
	preferences: owner.stores.generation,
	owns: (candidate: ChatStore) =>
		controller.current()?.stores.chat === candidate,
});

const newRoom = (owner: MobileLocalScope, title: string) =>
	owner.stores.chat.createRoom({
		originStoryId: "story-1",
		seed: seed(title),
		title,
	});

describe("the target needn't be the open room", () => {
	it("renames another row in the list — only that room changes", async () => {
		const first = await newRoom(alice, "First");
		const second = await newRoom(alice, "Second");

		expect(
			await renameManagedRoom(scopeOf(alice), first.id, "Edited first"),
		).toBe("done");

		expect((await alice.stores.chat.getRoom(first.id))?.title).toBe(
			"Edited first",
		);
		/** The neighbour is untouched: the target is a room id, not a list position. */
		expect((await alice.stores.chat.getRoom(second.id))?.title).toBe("Second");
	});

	it("deletes another row in the list — only that room disappears", async () => {
		const first = await newRoom(alice, "First");
		const second = await newRoom(alice, "Second");

		expect(await deleteManagedRoom(scopeOf(alice), second.id)).toBe("done");

		expect((await alice.stores.chat.listRooms()).map((r) => r.id)).toEqual([
			first.id,
		]);
	});

	/**
	 * The store takes a room's children in the same transaction (`deleteRoom` contract). This checks
	 * by value that the composition layer does not delete separately, which would turn atomicity into
	 * screen discipline and make a half-failed state representable.
	 */
	it("messages and memories disappear together", async () => {
		const room = await newRoom(alice, "A room to delete");
		await alice.stores.chat.appendMessage({
			roomId: room.id,
			role: "user",
			content: "One line",
		});
		await alice.stores.chat.createMemory({
			roomId: room.id,
			content: "One memory",
		});

		await deleteManagedRoom(scopeOf(alice), room.id);

		expect(await alice.stores.chat.listRecentMessages(room.id)).toEqual([]);
		expect(await alice.stores.chat.listMemories(room.id)).toEqual([]);
	});
});

describe("deletion clears that room's generation overrides", () => {
	/**
	 * Cleanup belongs to the composition layer because of the boundary: `deleteRoom` is a port of
	 * `@rowcat/chat` that web also implements, and putting this app's preference table there would
	 * make the domain store know the settings schema.
	 */
	it("the deleted room's overrides don't remain", async () => {
		const room = await newRoom(alice, "A room with changed settings");
		await alice.stores.generation.setRoom(room.id, {
			responseLength: "long",
			target: null,
			reasoningEffort: null,
		});
		expect(
			(await alice.stores.generation.getRoom(room.id)).responseLength,
		).toBe("long");

		await deleteManagedRoom(scopeOf(alice), room.id);

		/**
		 * Reads are lenient: a missing row means "not set", not an error (`generation-store.ts`). So the
		 * check is that the override is empty, not `null`; empty means the room inherits.
		 */
		expect(await alice.stores.generation.getRoom(room.id)).toEqual(
			EMPTY_GENERATION_PREFERENCE,
		);
	});

	/** The neighbour room's override is untouched; cleanup targets one room id. */
	it("doesn't touch other rooms' overrides", async () => {
		const gone = await newRoom(alice, "A room to delete");
		const stays = await newRoom(alice, "A room that stays");
		await alice.stores.generation.setRoom(gone.id, {
			responseLength: "long",
			target: null,
			reasoningEffort: null,
		});
		await alice.stores.generation.setRoom(stays.id, {
			responseLength: "short",
			target: null,
			reasoningEffort: null,
		});

		await deleteManagedRoom(scopeOf(alice), gone.id);

		expect(
			(await alice.stores.generation.getRoom(stays.id)).responseLength,
		).toBe("short");
	});
});

describe("after an account switch it doesn't write into someone else's database", () => {
	/**
	 * The account can change while the window is open; the confirm button's reference then points at a
	 * closed (or someone else's) database. Not swapping in the currently open scope is the whole
	 * defence.
	 */
	it("a rename pressed after the switch changes nothing", async () => {
		const room = await newRoom(alice, "Alice's room");
		const stale = scopeOf(alice);

		await controller.activate("bob");

		expect(await renameManagedRoom(stale, room.id, "A name Bob changed")).toBe(
			"foreign",
		);

		const back = await controller.activate("alice");
		expect((await back.stores.chat.getRoom(room.id))?.title).toBe(
			"Alice's room",
		);
	});

	it("a delete pressed after the switch deletes nothing either", async () => {
		const room = await newRoom(alice, "Alice's room");
		const stale = scopeOf(alice);

		await controller.activate("bob");

		expect(await deleteManagedRoom(stale, room.id)).toBe("foreign");

		const back = await controller.activate("alice");
		expect((await back.stores.chat.listRooms()).map((r) => r.id)).toEqual([
			room.id,
		]);
	});

	/**
	 * Deciding by member id would let this case through: in `Alice -> sign out -> Alice` the id is the
	 * same but the connection closed and reopened, and a write to the old instance goes to a closed
	 * connection. The axis must be the instance.
	 */
	it("even for the same member, a reopened scope is a different owner", async () => {
		const room = await newRoom(alice, "Alice's room");
		const stale = scopeOf(alice);

		await controller.release();
		const reopened = await controller.activate("alice");

		expect(
			await renameManagedRoom(
				stale,
				room.id,
				"Edited through the old connection",
			),
		).toBe("foreign");
		expect((await reopened.stores.chat.getRoom(room.id))?.title).toBe(
			"Alice's room",
		);
	});
});

describe("doesn't revive a vanished room", () => {
	/**
	 * The room can vanish after the menu opens (a delete elsewhere, a tombstone from sync). The store
	 * does not overwrite tombstones, so a late action does nothing quietly; on screen `RoomTarget`
	 * sees that and closes the window.
	 */
	it("renaming an already deleted room doesn't revive it", async () => {
		const room = await newRoom(alice, "A room that will disappear");
		await deleteManagedRoom(scopeOf(alice), room.id);

		await renameManagedRoom(scopeOf(alice), room.id, "A revived name");

		expect(await alice.stores.chat.getRoom(room.id)).toBeNull();
		expect(await alice.stores.chat.listRooms()).toEqual([]);
	});

	/** A second delete is quiet too: a retry that lost its response must not become an error. */
	it("deleting twice doesn't fail", async () => {
		const room = await newRoom(alice, "A room to delete twice");
		expect(await deleteManagedRoom(scopeOf(alice), room.id)).toBe("done");
		expect(await deleteManagedRoom(scopeOf(alice), room.id)).toBe("done");
	});
});

describe("the scope already provides account isolation", () => {
	/**
	 * No code in this feature filters by member id. List and actions only see the currently open
	 * scope's store, so isolation reduces to which file that store opens.
	 */
	it("Alice's room isn't in Bob's list, and is intact on return", async () => {
		const first = await newRoom(alice, "A");
		const second = await newRoom(alice, "B");

		const bob = await controller.activate("bob");
		expect(await bob.stores.chat.listRooms()).toEqual([]);

		const back = await controller.activate("alice");
		expect(
			(await back.stores.chat.listRooms()).map((r) => r.title).sort(),
		).toEqual([first.title, second.title].sort());
	});
});
