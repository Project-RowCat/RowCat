import type { ChatSeed, ChatStore } from "@rowcat/chat";
import { ChatSceneAudienceError } from "@rowcat/chat";
import { CHAT_SEED_VERSION } from "@rowcat/contracts";
import { StoryChatSeedDto } from "@rowcat/contracts/chat";
import { encryptRecord, nobleAead } from "@rowcat/sync";
import { afterEach, describe, expect, it } from "vitest";
import {
	activateLocalDbScope,
	resetLocalDbScope,
} from "#/lib/local-data/db.ts";
import {
	createDevice,
	type Device,
	FakeSyncServer,
	TEST_DEK,
} from "#/test/sync-devices.ts";
import { createChatStore } from "./store.ts";

/**
 * The room's fifth child (`packages/chat/src/scene.ts`) on real IndexedDB, plus the character alias
 * field that rides the same storage slice.
 *
 * What types do not prove: that a second `setScene` at one start updates instead of stacking a
 * second scene, that the audience is normalized before it is stored (two spellings would read as a
 * conflict on the next sync), and that both cascades (deleteRoom here, applyTombstone on the
 * receiving device) reach scenes. A scene left live in a deleted room is re-uploaded by the next
 * outbound collection.
 */

let sequence = 0;
const nextViewer = (label: string): string => `${label}-${++sequence}`;

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

const startOf = (message: { id: string; createdAt: string }) => ({
	createdAt: message.createdAt,
	messageId: message.id,
});

let devices: Device[] = [];
afterEach(() => {
	for (const device of devices) device.close();
	devices = [];
	resetLocalDbScope();
});

describe("scenes", () => {
	it("creates, reads back, and normalizes members (sorted, unique)", async () => {
		const db = activateLocalDbScope(nextViewer("alice"));
		const store = createChatStore(db);
		const room = await roomWith(store);
		const first = await store.appendMessage({
			roomId: room.id,
			role: "user",
			content: "Hello",
		});

		const scene = await store.setScene({
			roomId: room.id,
			startAt: startOf(first),
			audience: {
				kind: "participants",
				members: ["user", "char:b", " char:a ", "user"],
			},
		});

		expect(scene?.audience).toEqual({
			kind: "participants",
			members: ["char:a", "char:b", "user"],
		});
		expect(await store.listScenes(room.id)).toEqual([scene]);
		/* The row itself carries the members as a field, not a separate table. */
		expect((await db.chatScenes.get(scene?.id ?? ""))?.audience).toEqual(
			scene?.audience,
		);
		expect(scene).toMatchObject({
			dirty: 1,
			serverVersion: 0,
			deletedAt: null,
		});
	});

	it("a second set at the same start updates that scene instead of adding one", async () => {
		const store = createChatStore(activateLocalDbScope(nextViewer("alice")));
		const room = await roomWith(store);
		const first = await store.appendMessage({
			roomId: room.id,
			role: "user",
			content: "Hello",
		});
		const created = await store.setScene({
			roomId: room.id,
			startAt: startOf(first),
			audience: { kind: "room" },
		});

		const updated = await store.setScene({
			roomId: room.id,
			startAt: startOf(first),
			audience: { kind: "narrator" },
		});

		expect(updated?.id).toBe(created?.id);
		expect(updated?.audience).toEqual({ kind: "narrator" });
		expect(JSON.stringify(updated?.rev)).not.toBe(JSON.stringify(created?.rev));
		expect(await store.listScenes(room.id)).toHaveLength(1);

		/* The same audience again writes nothing (no new revision to push). */
		const again = await store.setScene({
			roomId: room.id,
			startAt: startOf(first),
			audience: { kind: "narrator" },
		});
		expect(again?.rev).toEqual(updated?.rev);
	});

	it("scenes at different starts are separate records", async () => {
		const store = createChatStore(activateLocalDbScope(nextViewer("alice")));
		const room = await roomWith(store);
		const first = await store.appendMessage({
			roomId: room.id,
			role: "user",
			content: "One",
		});
		const second = await store.appendMessage({
			roomId: room.id,
			role: "assistant",
			content: "Two",
		});
		await store.setScene({
			roomId: room.id,
			startAt: startOf(first),
			audience: { kind: "room" },
		});
		await store.setScene({
			roomId: room.id,
			startAt: startOf(second),
			audience: { kind: "participants", members: ["user"] },
		});

		expect(await store.listScenes(room.id)).toHaveLength(2);
	});

	/** Marking who was present is not conversation activity (the same judgment as characters). */
	it("setting a scene does not lift the room up the list", async () => {
		const store = createChatStore(activateLocalDbScope(nextViewer("alice")));
		const room = await roomWith(store);
		const first = await store.appendMessage({
			roomId: room.id,
			role: "user",
			content: "Hello",
		});
		const before = (await store.getRoom(room.id))?.updatedAt;

		await store.setScene({
			roomId: room.id,
			startAt: startOf(first),
			audience: { kind: "narrator" },
		});

		expect((await store.getRoom(room.id))?.updatedAt).toBe(before);
	});

	it("rejects an invalid audience outside the transaction, with its reason", async () => {
		const store = createChatStore(activateLocalDbScope(nextViewer("alice")));
		const room = await roomWith(store);
		const first = await store.appendMessage({
			roomId: room.id,
			role: "user",
			content: "Hello",
		});
		const set = (members: string[]) =>
			store.setScene({
				roomId: room.id,
				startAt: startOf(first),
				audience: { kind: "participants", members },
			});

		await expect(set([])).rejects.toBeInstanceOf(ChatSceneAudienceError);
		await expect(set(["Yujin"])).rejects.toMatchObject({
			reason: "invalid_member",
		});
		expect(await store.listScenes(room.id)).toEqual([]);
	});

	it("a missing or deleted room returns null and writes nothing", async () => {
		const db = activateLocalDbScope(nextViewer("alice"));
		const store = createChatStore(db);
		const room = await roomWith(store);
		await store.deleteRoom(room.id);
		const start = { createdAt: "2026-01-01T00:00:00.000Z", messageId: "m" };

		expect(
			await store.setScene({
				roomId: room.id,
				startAt: start,
				audience: { kind: "room" },
			}),
		).toBeNull();
		expect(
			await store.setScene({
				roomId: "nope",
				startAt: start,
				audience: { kind: "room" },
			}),
		).toBeNull();
		expect(await db.chatScenes.count()).toBe(0);
	});

	it("deleting removes it from the list, keeps a tombstone, and is idempotent", async () => {
		const db = activateLocalDbScope(nextViewer("alice"));
		const store = createChatStore(db);
		const room = await roomWith(store);
		const first = await store.appendMessage({
			roomId: room.id,
			role: "user",
			content: "Hello",
		});
		const scene = await store.setScene({
			roomId: room.id,
			startAt: startOf(first),
			audience: { kind: "room" },
		});

		await store.deleteScene(scene?.id ?? "");

		expect(await store.listScenes(room.id)).toEqual([]);
		expect(
			(await db.chatScenes.get(scene?.id ?? ""))?.deletedAt,
		).not.toBeNull();
		await expect(store.deleteScene(scene?.id ?? "")).resolves.toBeUndefined();

		/* A new set at the same start after a delete creates a fresh scene, not a revival. */
		const fresh = await store.setScene({
			roomId: room.id,
			startAt: startOf(first),
			audience: { kind: "narrator" },
		});
		expect(fresh?.id).not.toBe(scene?.id);
	});

	it("deleting the room tombstones its scenes in the same transaction", async () => {
		const db = activateLocalDbScope(nextViewer("alice"));
		const store = createChatStore(db);
		const room = await roomWith(store);
		const first = await store.appendMessage({
			roomId: room.id,
			role: "user",
			content: "Hello",
		});
		const scene = await store.setScene({
			roomId: room.id,
			startAt: startOf(first),
			audience: { kind: "participants", members: ["user"] },
		});

		await store.deleteRoom(room.id);

		/* The row, not the list (the list checks the room first and would pass vacuously). */
		const row = await db.chatScenes.get(scene?.id ?? "");
		expect(row?.deletedAt).not.toBeNull();
	});

	it("duplicating a room copies its scenes onto the copied messages and characters", async () => {
		const db = activateLocalDbScope(nextViewer("alice"));
		const store = createChatStore(db);
		const room = await roomWith(store);
		const first = await store.appendMessage({
			roomId: room.id,
			role: "user",
			content: "Hello",
		});
		const yujin = await store.createCharacter({
			roomId: room.id,
			name: "Yujin",
		});
		await store.setScene({
			roomId: room.id,
			startAt: startOf(first),
			audience: { kind: "participants", members: ["user", `char:${yujin.id}`] },
		});

		const copy = await store.duplicateRoom(room.id, "copy");
		const copyId = copy?.id ?? "";
		const [copiedMessage] = await store.listAllMessages(copyId);
		const [copiedCharacter] = await store.listCharacters(copyId);
		const scenes = await store.listScenes(copyId);

		expect(scenes).toHaveLength(1);
		expect(scenes[0]).toMatchObject({
			roomId: copyId,
			startAt: { createdAt: first.createdAt, messageId: copiedMessage?.id },
			audience: {
				kind: "participants",
				members: [`char:${copiedCharacter?.id}`, "user"].sort(),
			},
			dirty: 1,
			serverVersion: 0,
		});
		/* The original is untouched. */
		expect(await store.listScenes(room.id)).toHaveLength(1);
	});

	it("another room's scenes are not visible", async () => {
		const store = createChatStore(activateLocalDbScope(nextViewer("alice")));
		const a = await roomWith(store);
		const b = await roomWith(store);
		const first = await store.appendMessage({
			roomId: a.id,
			role: "user",
			content: "Hello",
		});
		await store.setScene({
			roomId: a.id,
			startAt: startOf(first),
			audience: { kind: "room" },
		});

		expect(await store.listScenes(b.id)).toEqual([]);
	});
});

describe("character aliases", () => {
	it("a rename keeps the old name as an alias", async () => {
		const db = activateLocalDbScope(nextViewer("alice"));
		const store = createChatStore(db);
		const room = await roomWith(store);
		const created = await store.createCharacter({
			roomId: room.id,
			name: "Yujin",
		});
		/* A fresh character stores no alias field at all (the codec's shape for "none"). */
		expect(created).not.toHaveProperty("aliases");

		await store.updateCharacter(created.id, { name: "Captain Yu" });
		await store.updateCharacter(created.id, { name: "Yu" });

		const [renamed] = await store.listCharacters(room.id);
		expect(renamed?.name).toBe("Yu");
		expect(renamed?.aliases).toEqual(["Yujin", "Captain Yu"]);
	});

	it("an explicit alias list is normalized and merged with the rename", async () => {
		const store = createChatStore(activateLocalDbScope(nextViewer("alice")));
		const room = await roomWith(store);
		const created = await store.createCharacter({
			roomId: room.id,
			name: "Yujin",
		});

		await store.updateCharacter(created.id, {
			aliases: [" Jinny ", "jinny", "", "Yujin"],
		});
		expect((await store.listCharacters(room.id))[0]?.aliases).toEqual([
			"Jinny",
		]);

		await store.updateCharacter(created.id, { name: "Yu", aliases: ["Kid"] });
		expect((await store.listCharacters(room.id))[0]?.aliases).toEqual([
			"Kid",
			"Yujin",
		]);

		/* Clearing the list removes the field rather than storing an empty array. */
		await store.updateCharacter(created.id, { aliases: [] });
		expect((await store.listCharacters(room.id))[0]).not.toHaveProperty(
			"aliases",
		);
	});
});

const seed = (title: string): ChatSeed => ({
	version: CHAT_SEED_VERSION,
	storyId: "s",
	title,
	tagline: "",
	adult: false,
	promptProtected: false,
	scenario: "",
	firstScene: "",
	playGuide: "",
	persona: null,
	characters: [],
	lore: [],
	startScenes: [],
	sceneImages: [],
});

const OWNER = "0123456789abcdef0123456789abcdef";

describe("scenes and aliases through sync", () => {
	const spawn = (server: FakeSyncServer, name: string): Device => {
		const device = createDevice(name, server);
		devices.push(device);
		return device;
	};

	it("a scene and a character's aliases arrive intact on the other device", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const room = await a.chat.createRoom({
			originStoryId: null,
			seed: seed("R"),
		});
		const first = await a.chat.appendMessage({
			roomId: room.id,
			role: "user",
			content: "Hello",
		});
		const yujin = await a.chat.createCharacter({
			roomId: room.id,
			name: "Yujin",
		});
		await a.chat.updateCharacter(yujin.id, { name: "Yu" });
		const scene = await a.chat.setScene({
			roomId: room.id,
			startAt: startOf(first),
			audience: { kind: "participants", members: [`char:${yujin.id}`, "user"] },
		});

		await a.engine.run(TEST_DEK);
		await b.engine.run(TEST_DEK);

		const [received] = await b.chat.listScenes(room.id);
		expect(received).toMatchObject({
			id: scene?.id,
			startAt: scene?.startAt,
			audience: scene?.audience,
			rev: scene?.rev,
			dirty: 0,
		});
		const [character] = await b.chat.listCharacters(room.id);
		expect(character?.aliases).toEqual(["Yujin"]);
		/* Nothing left to send back: the round trip reads as unchanged on both sides. */
		expect((await b.sync.collectOutbound({ limit: 50 })).records).toHaveLength(
			0,
		);
	});

	it("a room tombstone cascades to scenes on the receiving device", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const room = await a.chat.createRoom({
			originStoryId: null,
			seed: seed("R"),
		});
		const first = await a.chat.appendMessage({
			roomId: room.id,
			role: "user",
			content: "Hello",
		});
		const scene = await a.chat.setScene({
			roomId: room.id,
			startAt: startOf(first),
			audience: { kind: "narrator" },
		});
		await a.engine.run(TEST_DEK);
		await b.engine.run(TEST_DEK);
		expect(await b.chat.listScenes(room.id)).toHaveLength(1);

		await a.chat.deleteRoom(room.id);
		await a.engine.run(TEST_DEK);
		await b.engine.run(TEST_DEK);

		const row = await b.db.chatScenes.get(scene?.id ?? "");
		expect(row?.deletedAt).not.toBeNull();
		/* The cascade does not raise dirty: re-uploading a deleted room's scene is the bug it prevents. */
		expect(row?.dirty).toBe(0);
		expect((await b.sync.collectOutbound({ limit: 50 })).records).toHaveLength(
			0,
		);
	});

	it("a scene whose audience breaks the rules is rejected on decode, not widened", async () => {
		const server = new FakeSyncServer();
		const b = spawn(server, "b");
		const payload = (members: unknown) => ({
			schemaVersion: 1,
			rev: { t: 5, c: 0, d: "device-x" },
			deletedAt: null,
			data: {
				roomId: "room-x",
				startAt: { createdAt: "2026-01-01T00:00:00.000Z", messageId: "m1" },
				audience: { kind: "participants", members },
				createdAt: "2026-01-01T00:00:00.000Z",
				updatedAt: "2026-01-01T00:00:00.000Z",
			},
		});
		for (const [id, members] of [
			/* Control: a valid scene in the same page arrives, so the empty table below is meaningful. */
			["scene-ok", ["user", "user"]],
			["scene-empty", []],
			["scene-name", ["Yujin"]],
			["scene-shape", "user"],
		] as const) {
			server.seed({
				id,
				type: "chat.scene",
				ciphertext: await encryptRecord(
					TEST_DEK,
					{ owner: OWNER, recordId: id, type: "chat.scene" },
					payload(members),
					nobleAead,
				),
				envelope: 1,
				version: 1,
				deleted: false,
			});
		}

		await b.engine.run(TEST_DEK);

		const stored = await b.db.chatScenes.toArray();
		expect(stored.map((scene) => [scene.id, scene.audience])).toEqual([
			["scene-ok", { kind: "participants", members: ["user"] }],
		]);
	});
});
