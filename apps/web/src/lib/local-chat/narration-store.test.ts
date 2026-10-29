import type { ChatStore } from "@rowcat/chat";
import { DEFAULT_NARRATION_SETTINGS } from "@rowcat/chat";
import { StoryChatSeedDto } from "@rowcat/contracts/chat";
import { compareRev } from "@rowcat/sync";
import { afterEach, describe, expect, it } from "vitest";
import {
	activateLocalDbScope,
	resetLocalDbScope,
} from "#/lib/local-data/db.ts";
import { createChatStore } from "./store.ts";

/**
 * Room narration mode, on real IndexedDB. Types alone do not establish three things:
 * - the chosen value persists (the screen draws the next control based on it)
 * - turning it off removes the key entirely
 * - one edit is one revision The middle one is this slice's product decision: 'no pack' must have
 *   a single representation so that two-device round trips are idempotent. Only opening the stored
 *   object shows that.
 */

let sequence = 0;
const nextViewer = (label: string): string => `${label}-${++sequence}`;
const open = (viewerId: string): ChatStore =>
	createChatStore(activateLocalDbScope(viewerId));

const roomWith = (store: ChatStore) =>
	store.createRoom({
		originStoryId: null,
		seed: StoryChatSeedDto.parse({
			version: 1,
			storyId: "story-1",
			title: "Test story",
			adult: false,
			promptProtected: false,
		}),
	});

afterEach(() => {
	resetLocalDbScope();
});

describe("a room's narration", () => {
	it("a new room has no key: using no pack is the starting state", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);
		const stored = await store.getRoom(room.id);
		expect(stored && "narration" in stored).toBe(false);
	});

	it("the chosen value lands on the room", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);

		await store.setRoomNarration(room.id, {
			...DEFAULT_NARRATION_SETTINGS,
			scope: "auto",
		});

		expect((await store.getRoom(room.id))?.narration).toEqual({
			scope: "auto",
			density: "light",
			castTracking: false,
		});
	});

	/**
	 * The screen draws the density and character-card controls based on this one line. Right after a
	 * scope is chosen, `narration` must be non-null for those controls to appear.
	 */
	it("changing the scope carries the other two axes along", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);

		await store.setRoomNarration(room.id, {
			scope: "reactive",
			density: "rich",
			castTracking: true,
		});
		await store.setRoomNarration(room.id, {
			scope: "auto",
			density: "rich",
			castTracking: true,
		});

		expect((await store.getRoom(room.id))?.narration).toEqual({
			scope: "auto",
			density: "rich",
			castTracking: true,
		});
	});

	/**
	 * Turning it off removes the key. Storing null would give the same fact two record shapes, which
	 * only shows up as 'the same page applied twice gives different results'.
	 */
	it("turning it off removes the key itself", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);

		await store.setRoomNarration(room.id, DEFAULT_NARRATION_SETTINGS);
		await store.setRoomNarration(room.id, null);

		const stored = await store.getRoom(room.id);
		expect(stored && "narration" in stored).toBe(false);
	});

	it("one edit is one revision and sets dirty", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);

		await store.setRoomNarration(room.id, DEFAULT_NARRATION_SETTINGS);

		const stored = await store.getRoom(room.id);
		expect(stored?.dirty).toBeTruthy();
		expect(compareRev(stored?.rev ?? room.rev, room.rev)).toBeGreaterThan(0);
	});

	/**
	 * Calls on missing or deleted rooms are silently ignored (idempotent), so a late selection cannot
	 * overwrite a tombstone.
	 */
	it("does nothing for a missing room", async () => {
		const store = open(nextViewer("alice"));
		await expect(
			store.setRoomNarration("missing-room", DEFAULT_NARRATION_SETTINGS),
		).resolves.toBeUndefined();
	});
});
