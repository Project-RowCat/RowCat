import type { ChatStore } from "@rowcat/chat";
import { ChatSceneAudienceError } from "@rowcat/chat";
import type { SyncStore } from "@rowcat/sync";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seed } from "../../test/fixtures.ts";
import { tombstoneEntry, wireEntry } from "../../test/inbound.ts";
import {
	createMemorySecureStorage,
	createTempDirectory,
	createTestScopeController,
} from "../../test/sqlite-node.ts";
import { syncCodecRegistry } from "../local-sync/registry.ts";
import type { LocalScopeController } from "./activation.ts";
import type { MobileDatabase } from "./sqlite.ts";
import { chatCharacterTable, chatSceneTable } from "./tables.ts";

/**
 * The room's fifth child (`scene.ts` in `@rowcat/chat`) on real SQLite — the same matrix as the
 * web's `local-chat/scene-store.test.ts` — plus the character's alias column (v21).
 *
 * The audience is one JSON column. What is pinned here is that it round-trips as the normalized
 * value, that a broken stored value never reads wider than it was, and that both cascades
 * (`deleteRoom` here, `applyTombstone` on the receiving side) reach the new table.
 */

let temp: ReturnType<typeof createTempDirectory>;
let controller: LocalScopeController;
let chat: ChatStore;
let sync: SyncStore;
let db: MobileDatabase;

beforeEach(async () => {
	temp = createTempDirectory();
	controller = createTestScopeController(
		temp.path,
		createMemorySecureStorage(),
	);
	const scope = await controller.activate("alice");
	chat = scope.stores.chat;
	sync = scope.stores.sync;
	db = scope.db;
});

afterEach(async () => {
	await controller.release();
	temp.dispose();
});

const newRoom = (title = "Room") =>
	chat.createRoom({ originStoryId: null, seed: seed(title), title });

const firstMessage = async (roomId: string, content = "Hello") => {
	const message = await chat.appendMessage({ roomId, role: "user", content });
	return {
		message,
		startAt: { createdAt: message.createdAt, messageId: message.id },
	};
};

describe("Scene", () => {
	it("creates and reads back — members normalized into the JSON column", async () => {
		const room = await newRoom();
		const { startAt } = await firstMessage(room.id);

		const scene = await chat.setScene({
			roomId: room.id,
			startAt,
			audience: {
				kind: "participants",
				members: ["user", "char:b", " char:a ", "user"],
			},
		});

		expect(scene?.audience).toEqual({
			kind: "participants",
			members: ["char:a", "char:b", "user"],
		});
		expect(await chat.listScenes(room.id)).toEqual([scene]);
		const row = await db.first<{ audience: string }>(
			"SELECT audience FROM chat_scene WHERE id = ?",
			[scene?.id ?? ""],
		);
		expect(JSON.parse(row?.audience ?? "null")).toEqual(scene?.audience);
		expect(scene).toMatchObject({
			dirty: 1,
			serverVersion: 0,
			deletedAt: null,
		});
	});

	it("a second set at the same start updates that scene; the same value writes nothing", async () => {
		const room = await newRoom();
		const { startAt } = await firstMessage(room.id);
		const created = await chat.setScene({
			roomId: room.id,
			startAt,
			audience: { kind: "room" },
		});

		const updated = await chat.setScene({
			roomId: room.id,
			startAt,
			audience: { kind: "narrator" },
		});
		expect(updated?.id).toBe(created?.id);
		expect(updated?.audience).toEqual({ kind: "narrator" });
		expect(updated?.rev).not.toEqual(created?.rev);
		expect(await chat.listScenes(room.id)).toHaveLength(1);

		const again = await chat.setScene({
			roomId: room.id,
			startAt,
			audience: { kind: "narrator" },
		});
		expect(again?.rev).toEqual(updated?.rev);
	});

	it("does not lift the room up the list", async () => {
		const room = await newRoom();
		const { startAt } = await firstMessage(room.id);
		const before = (await chat.getRoom(room.id))?.updatedAt;

		await chat.setScene({
			roomId: room.id,
			startAt,
			audience: { kind: "narrator" },
		});

		expect((await chat.getRoom(room.id))?.updatedAt).toBe(before);
	});

	it("rejects an invalid audience with its reason and writes nothing", async () => {
		const room = await newRoom();
		const { startAt } = await firstMessage(room.id);
		const set = (members: string[]) =>
			chat.setScene({
				roomId: room.id,
				startAt,
				audience: { kind: "participants", members },
			});

		await expect(set([])).rejects.toBeInstanceOf(ChatSceneAudienceError);
		await expect(set(["Yujin"])).rejects.toMatchObject({
			reason: "invalid_member",
		});
		expect(await chat.listScenes(room.id)).toEqual([]);
	});

	it("a missing or deleted room returns null and writes nothing", async () => {
		const room = await newRoom();
		await chat.deleteRoom(room.id);
		const startAt = { createdAt: "2026-01-01T00:00:00.000Z", messageId: "m" };

		expect(
			await chat.setScene({
				roomId: room.id,
				startAt,
				audience: { kind: "room" },
			}),
		).toBeNull();
		expect(
			await chat.setScene({
				roomId: "nope",
				startAt,
				audience: { kind: "room" },
			}),
		).toBeNull();
		expect(await db.first("SELECT id FROM chat_scene")).toBeNull();
	});

	it("deletion is soft and idempotent", async () => {
		const room = await newRoom();
		const { startAt } = await firstMessage(room.id);
		const scene = await chat.setScene({
			roomId: room.id,
			startAt,
			audience: { kind: "room" },
		});

		await chat.deleteScene(scene?.id ?? "");
		await chat.deleteScene(scene?.id ?? "");

		expect(await chat.listScenes(room.id)).toEqual([]);
		const row = await db.first<{ deleted_at: string | null; dirty: number }>(
			"SELECT deleted_at, dirty FROM chat_scene WHERE id = ?",
			[scene?.id ?? ""],
		);
		expect(row?.deleted_at).not.toBeNull();
		expect(row?.dirty).toBe(1);
	});

	it("deleting a room tombstones its scenes in the same transaction", async () => {
		const room = await newRoom();
		const { startAt } = await firstMessage(room.id);
		const scene = await chat.setScene({
			roomId: room.id,
			startAt,
			audience: { kind: "participants", members: ["user"] },
		});

		await chat.deleteRoom(room.id);

		const row = await db.first<{ deleted_at: string | null }>(
			"SELECT deleted_at FROM chat_scene WHERE id = ?",
			[scene?.id ?? ""],
		);
		expect(row?.deleted_at).not.toBeNull();
	});

	it("duplicating a room copies scenes onto the copied message and character", async () => {
		const room = await newRoom();
		const { message, startAt } = await firstMessage(room.id);
		const yujin = await chat.createCharacter({
			roomId: room.id,
			name: "Yujin",
		});
		await chat.setScene({
			roomId: room.id,
			startAt,
			audience: { kind: "participants", members: ["user", `char:${yujin.id}`] },
		});

		const copy = await chat.duplicateRoom(room.id, "copy");
		const copyId = copy?.id ?? "";
		const [copiedMessage] = await chat.listAllMessages(copyId);
		const [copiedCharacter] = await chat.listCharacters(copyId);
		const scenes = await chat.listScenes(copyId);

		expect(scenes).toHaveLength(1);
		expect(scenes[0]).toMatchObject({
			roomId: copyId,
			startAt: { createdAt: message.createdAt, messageId: copiedMessage?.id },
			audience: {
				kind: "participants",
				members: [`char:${copiedCharacter?.id}`, "user"].sort(),
			},
			dirty: 1,
			serverVersion: 0,
		});
		expect(await chat.listScenes(room.id)).toHaveLength(1);
	});

	it("a stored audience that no longer parses reads as narrator, never wider", async () => {
		const room = await newRoom();
		const { startAt } = await firstMessage(room.id);
		const scene = await chat.setScene({
			roomId: room.id,
			startAt,
			audience: { kind: "participants", members: ["user"] },
		});
		for (const broken of [
			"{not json",
			'{"kind":"participants","members":[]}',
			'"room"',
		]) {
			await db.run("UPDATE chat_scene SET audience = ? WHERE id = ?", [
				broken,
				scene?.id ?? "",
			]);
			const row = await db.first<Record<string, unknown>>(
				"SELECT * FROM chat_scene WHERE id = ?",
				[scene?.id ?? ""],
			);
			expect(chatSceneTable.fromRow(row ?? {}).audience).toEqual({
				kind: "narrator",
			});
		}
	});
});

describe("Scene through the wire", () => {
	it("an arriving scene is stored as sent and leaves nothing to push back", async () => {
		const room = await newRoom();
		const { startAt } = await firstMessage(room.id);
		const scene = await chat.setScene({
			roomId: room.id,
			startAt,
			audience: { kind: "participants", members: ["seed:0", "user"] },
		});
		if (!scene) throw new Error("scene");
		await db.run("DELETE FROM chat_scene", []);

		await sync.applyPull({
			entries: [wireEntry({ type: "chat.scene", record: scene, version: 3 })],
			cursor: 3,
		});

		const [stored] = await chat.listScenes(room.id);
		expect(stored).toEqual({ ...scene, dirty: 0, serverVersion: 3 });
	});

	it("a room tombstone cascades to scenes on the receiving side", async () => {
		const room = await newRoom();
		const { startAt } = await firstMessage(room.id);
		const scene = await chat.setScene({
			roomId: room.id,
			startAt,
			audience: { kind: "narrator" },
		});
		if (!scene) throw new Error("scene");
		for (const table of ["chat_room", "chat_message", "chat_scene"])
			await db.run(`DELETE FROM ${table}`, []);

		await sync.applyPull({
			entries: [
				wireEntry({ type: "chat.scene", record: scene, version: 2 }),
				tombstoneEntry({
					type: "chat.room",
					id: room.id,
					version: 3,
					serverUpdatedAt: "2026-02-02T00:00:00.000Z",
				}),
			],
			cursor: 3,
		});

		const row = await db.first<{ deleted_at: string | null; dirty: number }>(
			"SELECT deleted_at, dirty FROM chat_scene WHERE id = ?",
			[scene.id],
		);
		expect(row?.deleted_at).toBe("2026-02-02T00:00:00.000Z");
		expect(row?.dirty).toBe(0);
		expect((await sync.collectOutbound({ limit: 50 })).records).toHaveLength(0);
	});

	it("the codec rejects a malformed audience instead of widening it", () => {
		const codec = syncCodecRegistry.get("chat.scene");
		expect(codec).not.toBeNull();
		const decode = (audience: unknown) =>
			codec?.decode({
				id: "scene-x",
				schemaVersion: 1,
				rev: { t: 1, c: 0, d: "d" },
				deletedAt: null,
				data: {
					roomId: "room-x",
					startAt: { createdAt: "2026-01-01T00:00:00.000Z", messageId: "m" },
					audience,
					createdAt: "2026-01-01T00:00:00.000Z",
					updatedAt: "2026-01-01T00:00:00.000Z",
				},
			});
		expect(decode({ kind: "participants", members: [] })).toBeNull();
		expect(decode({ kind: "participants", members: ["Yujin"] })).toBeNull();
		expect(decode({ kind: "everyone" })).toBeNull();
		expect(
			decode({ kind: "participants", members: ["user", "user"] }),
		).toMatchObject({
			audience: { kind: "participants", members: ["user"] },
		});
	});
});

describe("Character aliases", () => {
	it("a rename keeps the old name, and the column round-trips", async () => {
		const room = await newRoom();
		const created = await chat.createCharacter({
			roomId: room.id,
			name: "Yujin",
		});
		expect(created).not.toHaveProperty("aliases");

		await chat.updateCharacter(created.id, { name: "Captain Yu" });
		await chat.updateCharacter(created.id, { name: "Yu" });

		const [renamed] = await chat.listCharacters(room.id);
		expect(renamed?.name).toBe("Yu");
		expect(renamed?.aliases).toEqual(["Yujin", "Captain Yu"]);
		const row = await db.first<{ aliases: string | null }>(
			"SELECT aliases FROM chat_character WHERE id = ?",
			[created.id],
		);
		expect(JSON.parse(row?.aliases ?? "null")).toEqual(["Yujin", "Captain Yu"]);
	});

	it("an explicit list is normalized; clearing it stores NULL and reads as no key", async () => {
		const room = await newRoom();
		const created = await chat.createCharacter({
			roomId: room.id,
			name: "Yujin",
		});

		await chat.updateCharacter(created.id, {
			aliases: [" Jinny ", "jinny", "", "Yujin"],
		});
		expect((await chat.listCharacters(room.id))[0]?.aliases).toEqual(["Jinny"]);

		await chat.updateCharacter(created.id, { name: "Yu", aliases: ["Kid"] });
		expect((await chat.listCharacters(room.id))[0]?.aliases).toEqual([
			"Kid",
			"Yujin",
		]);

		await chat.updateCharacter(created.id, { aliases: [] });
		const [cleared] = await chat.listCharacters(room.id);
		expect(cleared).not.toHaveProperty("aliases");
		const row = await db.first<{ aliases: string | null }>(
			"SELECT aliases FROM chat_character WHERE id = ?",
			[created.id],
		);
		expect(row?.aliases).toBeNull();
	});

	it("aliases arrive through the wire and are stored", async () => {
		const room = await newRoom();
		const created = await chat.createCharacter({
			roomId: room.id,
			name: "Yujin",
		});
		await chat.updateCharacter(created.id, { name: "Yu" });
		const [renamed] = await chat.listCharacters(room.id);
		if (!renamed) throw new Error("character");
		await db.run("DELETE FROM chat_character", []);

		await sync.applyPull({
			entries: [
				wireEntry({ type: "chat.character", record: renamed, version: 2 }),
			],
			cursor: 2,
		});

		const row = await db.first<Record<string, unknown>>(
			"SELECT * FROM chat_character WHERE id = ?",
			[created.id],
		);
		expect(chatCharacterTable.fromRow(row ?? {})).toEqual({
			...renamed,
			dirty: 0,
			serverVersion: 2,
		});
	});
});
