import type { ChatStore } from "@rowcat/chat";
import {
	CHAT_ATTACHMENT_MAX_PER_ROOM,
	ChatAttachmentContentError,
	ChatAttachmentLimitError,
	ChatRoomMissingError,
} from "@rowcat/chat";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { seed } from "../../test/fixtures.ts";
import {
	createMemorySecureStorage,
	createTempDirectory,
	createTestScopeController,
} from "../../test/sqlite-node.ts";
import type { LocalScopeController } from "./activation.ts";
import type { MobileDatabase } from "./sqlite.ts";

/**
 * The room's sixth child on SQLite — the same matrix as the web adapter. This app has no picker yet,
 * but a file attached on the web is stored here (`chat_attachment`, v24), read on this device's
 * turns, and must leave with its room.
 */

let temp: ReturnType<typeof createTempDirectory>;
let controller: LocalScopeController;
let chat: ChatStore;
let db: MobileDatabase;

beforeEach(async () => {
	temp = createTempDirectory();
	controller = createTestScopeController(
		temp.path,
		createMemorySecureStorage(),
	);
	const scope = await controller.activate("alice");
	chat = scope.stores.chat;
	db = scope.db;
});

afterEach(async () => {
	await controller.release();
	temp.dispose();
});

const newRoom = () =>
	chat.createRoom({
		originStoryId: "story-1",
		seed: seed("Room"),
		title: "Room",
	});

describe("attachments", () => {
	it("attaches, lists in attach order, and removes idempotently", async () => {
		const room = await newRoom();
		const a = await chat.createAttachment({
			roomId: room.id,
			name: "world.md",
			content: "# World\r\nHarbor.",
		});
		await chat.createAttachment({
			roomId: room.id,
			name: "b.txt",
			content: "b",
		});
		expect(a.content).toBe("# World\nHarbor.");
		expect((await chat.listAttachments(room.id)).map((x) => x.name)).toEqual([
			"world.md",
			"b.txt",
		]);
		await chat.deleteAttachment(a.id);
		await chat.deleteAttachment(a.id);
		expect((await chat.listAttachments(room.id)).map((x) => x.name)).toEqual([
			"b.txt",
		]);
	});

	it("refuses binary text and enforces the count cap", async () => {
		const room = await newRoom();
		await expect(
			chat.createAttachment({ roomId: room.id, name: "x", content: "\u0000" }),
		).rejects.toBeInstanceOf(ChatAttachmentContentError);
		for (let i = 0; i < CHAT_ATTACHMENT_MAX_PER_ROOM; i++)
			await chat.createAttachment({
				roomId: room.id,
				name: `${i}.txt`,
				content: "x",
			});
		await expect(
			chat.createAttachment({ roomId: room.id, name: "z.txt", content: "x" }),
		).rejects.toBeInstanceOf(ChatAttachmentLimitError);
	});

	it("deleting the room tombstones its files in the same transaction", async () => {
		const room = await newRoom();
		await chat.createAttachment({ roomId: room.id, name: "a", content: "x" });
		await chat.deleteRoom(room.id);
		const rows = await db.all<{ deleted_at: string | null }>(
			"SELECT deleted_at FROM chat_attachment WHERE room_id = ?",
			[room.id],
		);
		expect(rows).toHaveLength(1);
		expect(rows[0]?.deleted_at).not.toBeNull();
		await expect(
			chat.createAttachment({ roomId: room.id, name: "b", content: "y" }),
		).rejects.toBeInstanceOf(ChatRoomMissingError);
	});

	it("a duplicated room carries the files", async () => {
		const room = await newRoom();
		await chat.createAttachment({
			roomId: room.id,
			name: "a.md",
			content: "x",
		});
		const copy = await chat.duplicateRoom(room.id, "Copy");
		const copied = await chat.listAttachments(copy?.id ?? "");
		expect(copied.map((x) => x.name)).toEqual(["a.md"]);
	});
});
