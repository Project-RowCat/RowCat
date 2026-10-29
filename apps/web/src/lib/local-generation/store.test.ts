import type { ChatSeed, GenerationPreferenceStore } from "@rowcat/chat";
import {
	EMPTY_GENERATION_PREFERENCE,
	GLOBAL_PREFERENCE_KEY,
	resolveEffectiveGeneration,
	roomPreferenceKey,
} from "@rowcat/chat";
import { StoryChatSeedDto } from "@rowcat/contracts/chat";
import { afterEach, describe, expect, it } from "vitest";
import { createChatStore } from "#/lib/local-chat/store.ts";
import {
	activateLocalDbScope,
	LocalDb,
	resetLocalDbScope,
} from "#/lib/local-data/db.ts";
import { syncCodecRegistry } from "#/lib/local-sync/registry.ts";
import { createDexieSyncStore } from "#/lib/local-sync/store.ts";
import { createGenerationPreferenceStore } from "./store.ts";

/**
 * This is a device preference store holding the user's persistent settings, so types alone are not
 * enough. Everything that breaks here breaks silently. If account isolation fails, Bob's screen
 * shows the default Alice chose. If 'not chosen' were stored as a value, things would look fine at
 * first. On the day the product default changed, only those users would stay on the old value. If
 * this value accidentally gained a sync axis, it would leak to other devices.
 */

let sequence = 0;
const nextViewer = (label: string): string => `${label}-${++sequence}`;

const open = (viewerId: string): GenerationPreferenceStore =>
	createGenerationPreferenceStore(activateLocalDbScope(viewerId));

const seed = (): ChatSeed =>
	StoryChatSeedDto.parse({
		version: 1,
		storyId: "story-1",
		title: "Test story",
		adult: false,
		promptProtected: false,
	});

afterEach(() => {
	resetLocalDbScope();
});

describe("persistence", () => {
	it("closing and reopening as the same member keeps the chosen value", async () => {
		const alice = nextViewer("alice");
		await open(alice).setGlobal({
			responseLength: "long",
			target: null,
			reasoningEffort: null,
		});

		// Logout only closes the connection. Settings are not cleared, because they are not data.
		resetLocalDbScope();

		expect(await open(alice).getGlobal()).toEqual({
			responseLength: "long",
			target: null,
			reasoningEffort: null,
		});
	});

	it("room overrides stay after signing back in", async () => {
		const alice = nextViewer("alice");
		await open(alice).setRoom("room-a", {
			responseLength: "short",
			target: null,
			reasoningEffort: null,
		});
		resetLocalDbScope();
		expect(await open(alice).getRoom("room-a")).toEqual({
			responseLength: "short",
			target: null,
			reasoningEffort: null,
		});
	});
});

describe("account isolation", () => {
	it("what Alice chose is not visible to Bob", async () => {
		const alice = nextViewer("alice");
		const bob = nextViewer("bob");

		await open(alice).setGlobal({
			responseLength: "long",
			target: null,
			reasoningEffort: null,
		});

		// Switching accounts opens a database with a different name.
		resetLocalDbScope();
		expect(await open(bob).getGlobal()).toEqual(EMPTY_GENERATION_PREFERENCE);
	});

	/**
	 * Bob's own choice must leave Alice's unchanged. Checking only one side would not distinguish this
	 * from a test that passes because both are empty.
	 */
	it("two members have different values", async () => {
		const alice = nextViewer("alice");
		const bob = nextViewer("bob");

		await open(alice).setGlobal({
			responseLength: "long",
			target: null,
			reasoningEffort: null,
		});
		resetLocalDbScope();
		await open(bob).setGlobal({
			responseLength: "short",
			target: null,
			reasoningEffort: null,
		});
		resetLocalDbScope();

		expect(await open(alice).getGlobal()).toEqual({
			responseLength: "long",
			target: null,
			reasoningEffort: null,
		});
		resetLocalDbScope();
		expect(await open(bob).getGlobal()).toEqual({
			responseLength: "short",
			target: null,
			reasoningEffort: null,
		});
	});

	it("signing back in as the same member keeps it", async () => {
		const alice = nextViewer("alice");
		const bob = nextViewer("bob");

		await open(alice).setGlobal({
			responseLength: "long",
			target: null,
			reasoningEffort: null,
		});
		resetLocalDbScope();
		await open(bob).getGlobal();
		resetLocalDbScope();

		expect(await open(alice).getGlobal()).toEqual({
			responseLength: "long",
			target: null,
			reasoningEffort: null,
		});
	});
});

describe("isolation between rooms", () => {
	it("A's override does not leak into B", async () => {
		const store = open(nextViewer("alice"));
		await store.setRoom("room-a", {
			responseLength: "short",
			target: null,
			reasoningEffort: null,
		});

		expect(await store.getRoom("room-a")).toEqual({
			responseLength: "short",
			target: null,
			reasoningEffort: null,
		});
		expect(await store.getRoom("room-b")).toEqual(EMPTY_GENERATION_PREFERENCE);
	});

	it("a room with an override keeps its value when the global changes", async () => {
		const store = open(nextViewer("alice"));
		await store.setRoom("room-a", {
			responseLength: "short",
			target: null,
			reasoningEffort: null,
		});
		await store.setGlobal({
			responseLength: "long",
			target: null,
			reasoningEffort: null,
		});

		const roomA = resolveEffectiveGeneration({
			global: await store.getGlobal(),
			room: await store.getRoom("room-a"),
		});
		const roomB = resolveEffectiveGeneration({
			global: await store.getGlobal(),
			room: await store.getRoom("room-b"),
		});

		expect(roomA.responseLength).toBe("short");
		expect(roomB.responseLength).toBe("long");
	});
});

describe("runtime story overrides", () => {
	/**
	 * Same table as rooms, different prefix. The same string id used for a room and for a story must
	 * not see each other. If the prefixes matched, the cleanup for deleting a room would also delete
	 * the story's value.
	 */
	it("a room and a story with the same id do not see each other", async () => {
		const store = open(nextViewer("alice"));
		await store.setRuntime("shared-id", {
			responseLength: null,
			target: { provider: "rowcat", model: "claude-sonnet-5" },
			reasoningEffort: "high",
		});

		expect(await store.getRoom("shared-id")).toEqual(
			EMPTY_GENERATION_PREFERENCE,
		);
		expect(await store.getRuntime("shared-id")).toEqual({
			responseLength: null,
			target: { provider: "rowcat", model: "claude-sonnet-5" },
			reasoningEffort: "high",
		});
	});

	/**
	 * Clearing a room must not touch the story's override. The two values have different lifetimes.
	 */
	it("clearRoom does not clear a story's override", async () => {
		const store = open(nextViewer("alice"));
		await store.setRuntime("story-a", {
			responseLength: null,
			target: null,
			reasoningEffort: "low",
		});
		await store.clearRoom("story-a");
		expect((await store.getRuntime("story-a")).reasoningEffort).toBe("low");
	});

	it("stories do not see each other and sit above the global", async () => {
		const store = open(nextViewer("alice"));
		await store.setGlobal({
			responseLength: null,
			target: null,
			reasoningEffort: "high",
		});
		await store.setRuntime("story-a", {
			responseLength: null,
			target: null,
			reasoningEffort: "minimal",
		});

		const storyA = resolveEffectiveGeneration({
			global: await store.getGlobal(),
			room: await store.getRuntime("story-a"),
		});
		const storyB = resolveEffectiveGeneration({
			global: await store.getGlobal(),
			room: await store.getRuntime("story-b"),
		});
		expect(storyA.reasoningEffort).toBe("minimal");
		expect(storyB.reasoningEffort).toBe("high");
	});

	/**
	 * Writing an empty preference deletes the row. This is the same rule as for rooms, and it is why
	 * there is no separate delete operation.
	 */
	it("writing an empty preference removes the row", async () => {
		const store = open(nextViewer("alice"));
		await store.setRuntime("story-a", {
			responseLength: null,
			target: null,
			reasoningEffort: "low",
		});
		await store.setRuntime("story-a", EMPTY_GENERATION_PREFERENCE);
		expect(await store.getRuntime("story-a")).toEqual(
			EMPTY_GENERATION_PREFERENCE,
		);
	});

	it("stays after signing back in", async () => {
		const alice = nextViewer("alice");
		await open(alice).setRuntime("story-a", {
			responseLength: null,
			target: { provider: "rowcat", model: "claude-sonnet-5" },
			reasoningEffort: null,
		});
		resetLocalDbScope();
		expect((await open(alice).getRuntime("story-a")).target).toEqual({
			provider: "rowcat",
			model: "claude-sonnet-5",
		});
	});
});

describe("reasoning axis", () => {
	/**
	 * When an axis is added, isEmptyGenerationPreference must be updated as well. If that is
	 * forgotten, a preference that holds only a reasoning value is deleted right after it is saved,
	 * because the store deletes any row it receives as empty.
	 */
	it("choosing only reasoning keeps the row", async () => {
		const store = open(nextViewer("alice"));
		await store.setRoom("room-a", {
			responseLength: null,
			target: null,
			reasoningEffort: "high",
		});
		expect(await store.getRoom("room-a")).toEqual({
			responseLength: null,
			target: null,
			reasoningEffort: "high",
		});
	});

	it("clearing reasoning keeps the other axes", async () => {
		const store = open(nextViewer("alice"));
		await store.setRoom("room-a", {
			responseLength: "short",
			target: null,
			reasoningEffort: "high",
		});
		await store.setRoom("room-a", {
			responseLength: "short",
			target: null,
			reasoningEffort: null,
		});
		expect(await store.getRoom("room-a")).toEqual({
			responseLength: "short",
			target: null,
			reasoningEffort: null,
		});
	});
});

describe("reverting to defaults", () => {
	it("writing an empty preference removes the row itself", async () => {
		const alice = nextViewer("alice");
		const db = activateLocalDbScope(alice);
		const store = createGenerationPreferenceStore(db);

		await store.setGlobal({
			responseLength: "long",
			target: null,
			reasoningEffort: null,
		});
		expect(
			await db.generationPreferences.get(GLOBAL_PREFERENCE_KEY),
		).toBeDefined();

		await store.setGlobal(EMPTY_GENERATION_PREFERENCE);
		expect(
			await db.generationPreferences.get(GLOBAL_PREFERENCE_KEY),
		).toBeUndefined();
		expect(await store.getGlobal()).toEqual(EMPTY_GENERATION_PREFERENCE);
	});

	it("clearing a room override inherits the global again", async () => {
		const store = open(nextViewer("alice"));
		await store.setGlobal({
			responseLength: "long",
			target: null,
			reasoningEffort: null,
		});
		await store.setRoom("room-a", {
			responseLength: "short",
			target: null,
			reasoningEffort: null,
		});

		await store.clearRoom("room-a");

		const effective = resolveEffectiveGeneration({
			global: await store.getGlobal(),
			room: await store.getRoom("room-a"),
		});
		expect(effective.responseLength).toBe("long");
		expect(effective.sources.responseLength).toBe("global");
	});

	it("clearing a missing room succeeds (idempotent)", async () => {
		const store = open(nextViewer("alice"));
		await expect(store.clearRoom("does-not-exist")).resolves.toBeUndefined();
		await store.setRoom("room-a", {
			responseLength: "short",
			target: null,
			reasoningEffort: null,
		});
		await store.clearRoom("room-a");
		await expect(store.clearRoom("room-a")).resolves.toBeUndefined();
	});
});

describe("corrupt rows", () => {
	/**
	 * This value is read right before generation. If it threw, the user would see the conversation
	 * break rather than the settings. So an unknown value falls back to 'not chosen', and the product
	 * default applies.
	 */
	it("an unknown response length reads as unchosen", async () => {
		const db = activateLocalDbScope(nextViewer("alice"));
		const store = createGenerationPreferenceStore(db);

		await db.generationPreferences.put({
			key: GLOBAL_PREFERENCE_KEY,
			version: 1,
			responseLength: "gigantic",
		});

		expect(await store.getGlobal()).toEqual(EMPTY_GENERATION_PREFERENCE);
		expect(
			resolveEffectiveGeneration({ global: await store.getGlobal() }),
		).toMatchObject({ sources: { responseLength: "product" } });
	});

	/**
	 * A reasoning step removed from the vocabulary is treated the same way: it reads as 'no override'.
	 * This axis is especially prone to the problem because the valid range depends on the model. If
	 * the stored string passed through, it would be sent with the request. Managed models have the
	 * server fold it, but BYO providers reject it, and one setting would then block the conversation.
	 */
	it("an unknown reasoning level reads as unchosen", async () => {
		const db = activateLocalDbScope(nextViewer("alice"));
		const store = createGenerationPreferenceStore(db);

		await db.generationPreferences.put({
			key: GLOBAL_PREFERENCE_KEY,
			version: 1,
			responseLength: null,
			reasoningEffort: "insane",
		});

		expect(await store.getGlobal()).toEqual(EMPTY_GENERATION_PREFERENCE);
		expect(
			resolveEffectiveGeneration({ global: await store.getGlobal() }),
		).toMatchObject({ sources: { reasoningEffort: "product" } });
	});

	/**
	 * Rows saved before the reasoning axis existed have no key. These rows must still read correctly,
	 * so the feature can be added without a destructive migration. The result must match exactly what
	 * happened before this axis existed.
	 */
	it("old rows without a reasoning key still read", async () => {
		const db = activateLocalDbScope(nextViewer("alice"));
		const store = createGenerationPreferenceStore(db);

		await db.generationPreferences.put({
			key: GLOBAL_PREFERENCE_KEY,
			version: 1,
			responseLength: "long",
		});

		expect(await store.getGlobal()).toEqual({
			responseLength: "long",
			target: null,
			reasoningEffort: null,
		});
	});

	it("rows of an unknown version are ignored", async () => {
		const db = activateLocalDbScope(nextViewer("alice"));
		const store = createGenerationPreferenceStore(db);

		await db.generationPreferences.put({
			key: GLOBAL_PREFERENCE_KEY,
			version: 99,
			responseLength: "long",
		});

		expect(await store.getGlobal()).toEqual(EMPTY_GENERATION_PREFERENCE);
	});
});

describe("not synced", () => {
	/**
	 * This is the most important section in this file. If the device preference gained a sync axis,
	 * its value would leak to other devices. Once BYO ships, it would become a default that cannot be
	 * used on that device.
	 */
	it("stored rows have no sync metadata", async () => {
		const db = activateLocalDbScope(nextViewer("alice"));
		const store = createGenerationPreferenceStore(db);
		await store.setGlobal({
			responseLength: "long",
			target: null,
			reasoningEffort: null,
		});

		const row = await db.generationPreferences.get(GLOBAL_PREFERENCE_KEY);
		expect(row).toBeDefined();
		expect(row).not.toHaveProperty("dirty");
		expect(row).not.toHaveProperty("rev");
		expect(row).not.toHaveProperty("serverVersion");
		expect(row).not.toHaveProperty("deletedAt");
	});

	it("changing preferences creates no push candidates", async () => {
		const db = activateLocalDbScope(nextViewer("alice"));
		const preferences = createGenerationPreferenceStore(db);
		const sync = createDexieSyncStore(db, syncCodecRegistry);

		await preferences.setGlobal({
			responseLength: "long",
			target: null,
			reasoningEffort: null,
		});
		await preferences.setRoom("room-a", {
			responseLength: "short",
			target: null,
			reasoningEffort: null,
		});

		/**
		 * all: true ignores dirty and scans every record (the bootstrap path). Even so, this table must
		 * produce no records at all, because it is not in the protocol's type vocabulary.
		 */
		const batch = await sync.collectOutbound({ limit: 100, all: true });
		expect(batch.records).toHaveLength(0);
	});

	it("changing preferences does not dirty the room or raise its revision", async () => {
		const db = activateLocalDbScope(nextViewer("alice"));
		const chat = createChatStore(db);
		const preferences = createGenerationPreferenceStore(db);
		const sync = createDexieSyncStore(db, syncCodecRegistry);

		const room = await chat.createRoom({
			originStoryId: "story-1",
			seed: seed(),
		});
		// Clears the room's dirty flag. A newly created room starts with dirty=1.
		await sync.commitPush([
			{ id: room.id, type: "chat.room", version: 1, rev: room.rev },
		]);

		const before = await db.rooms.get(room.id);
		expect(before?.dirty).toBe(0);

		await preferences.setRoom(room.id, {
			responseLength: "short",
			target: null,
			reasoningEffort: null,
		});
		await preferences.setGlobal({
			responseLength: "long",
			target: null,
			reasoningEffort: null,
		});

		const after = await db.rooms.get(room.id);
		expect(after?.dirty).toBe(0);
		expect(after?.rev).toEqual(before?.rev);
		expect(after?.updatedAt).toBe(before?.updatedAt);

		const batch = await sync.collectOutbound({ limit: 100 });
		expect(batch.records).toHaveLength(0);
	});
});

describe("what generation reads, in order", () => {
	/**
	 * This reproduces what the hook does without React (use-chat-generation.ts). When a request
	 * starts, the settings are read once and frozen. Later changes apply from the next request. This
	 * ordering is a product rule. If the user changes settings while a response is streaming, the
	 * in-flight request must finish with the settings it started with, and it must not be cancelled
	 * because the settings changed.
	 */
	it("settings frozen at start ignore changes midway", async () => {
		const store = open(nextViewer("alice"));
		await store.setGlobal({
			responseLength: "short",
			target: null,
			reasoningEffort: null,
		});

		// Generation starts here, and the settings are frozen at this point.
		const snapshot = resolveEffectiveGeneration({
			global: await store.getGlobal(),
			room: await store.getRoom("room-a"),
		});
		expect(snapshot.responseLength).toBe("short");

		// The user changes settings while a response is still streaming.
		await store.setGlobal({
			responseLength: "long",
			target: null,
			reasoningEffort: null,
		});

		// The in-flight request is unaffected. The snapshot is a local variable, so nothing can change
		// it.
		expect(snapshot.responseLength).toBe("short");

		// The next request reads the new values.
		const next = resolveEffectiveGeneration({
			global: await store.getGlobal(),
			room: await store.getRoom("room-a"),
		});
		expect(next.responseLength).toBe("long");
	});

	/**
	 * Changes made in another tab are seen by the next request. This holds because the hook reads from
	 * the store directly rather than from render state, so no BroadcastChannel is needed.
	 */
	it("the next request reads a value changed in another tab", async () => {
		const alice = nextViewer("alice");
		const tabA = open(alice);

		// A second tab: a separate connection to the same database name.
		const tabBDb = new LocalDb(`rowcat_chat_${alice}`);
		const tabB = createGenerationPreferenceStore(tabBDb);

		await tabB.setGlobal({
			responseLength: "long",
			target: null,
			reasoningEffort: null,
		});

		expect(await tabA.getGlobal()).toEqual({
			responseLength: "long",
			target: null,
			reasoningEffort: null,
		});
		tabBDb.close();
	});

	it("without preferences the product default stands", async () => {
		const store = open(nextViewer("alice"));
		const effective = resolveEffectiveGeneration({
			global: await store.getGlobal(),
			room: await store.getRoom("room-a"),
		});
		expect(effective.sources.responseLength).toBe("product");
	});
});

describe("room deletion cleanup", () => {
	/**
	 * Deleting a room must also leave no override for that room. Cleanup happens in the local
	 * composition layer for boundary reasons. If @rowcat/chat's deleteRoom knew about preferences, the
	 * domain store would know about the web settings table (see features/chat/room/management.tsx).
	 */
	it("clearing the override makes the room follow its parent again", async () => {
		const store = open(nextViewer("alice"));
		await store.setGlobal({
			responseLength: "long",
			target: null,
			reasoningEffort: null,
		});
		await store.setRoom("room-a", {
			responseLength: "short",
			target: null,
			reasoningEffort: null,
		});

		await store.clearRoom("room-a");

		expect(await store.getRoom("room-a")).toEqual(EMPTY_GENERATION_PREFERENCE);
	});

	it("a room recreated with the same id does not revive the old override", async () => {
		const alice = nextViewer("alice");
		const db = activateLocalDbScope(alice);
		const store = createGenerationPreferenceStore(db);

		await store.setRoom("room-a", {
			responseLength: "short",
			target: null,
			reasoningEffort: null,
		});
		await store.clearRoom("room-a");

		expect(
			await db.generationPreferences.get(roomPreferenceKey("room-a")),
		).toBeUndefined();
	});
});
