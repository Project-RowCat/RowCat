import type { ChatStore } from "@rowcat/chat";
import {
	CHAT_ATTACHMENT_MAX_PER_ROOM,
	CHAT_ATTACHMENT_ROOM_MAX_LENGTH,
	ChatAttachmentContentError,
	ChatAttachmentLimitError,
	ChatRoomMissingError,
} from "@rowcat/chat";
import { StoryChatSeedDto } from "@rowcat/contracts/chat";
import { afterEach, describe, expect, it } from "vitest";
import {
	activateLocalDbScope,
	resetLocalDbScope,
} from "#/lib/local-data/db.ts";
import { createChatStore } from "./store.ts";

/**
 * The room's sixth child, on real IndexedDB: the caps are the store's (not only the screen's), a
 * refused file keeps its error type through the transaction, and deleting or duplicating the room
 * carries the files along — a missed cascade would let the next sync re-upload a deleted room's
 * files.
 */

let sequence = 0;
const open = (): ChatStore =>
	createChatStore(activateLocalDbScope(`attach-${++sequence}`));

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

describe("attachments", () => {
	it("attaches, lists in attach order, and removes", async () => {
		const store = open();
		const room = await roomWith(store);
		const a = await store.createAttachment({
			roomId: room.id,
			name: "world.md",
			content: "﻿# World\r\nA harbor town.\r\n",
		});
		await store.createAttachment({
			roomId: room.id,
			name: "cast.txt",
			content: "Mira",
		});
		expect(a.content).toBe("# World\nA harbor town.");
		expect((await store.listAttachments(room.id)).map((x) => x.name)).toEqual([
			"world.md",
			"cast.txt",
		]);

		await store.deleteAttachment(a.id);
		await store.deleteAttachment(a.id);
		expect((await store.listAttachments(room.id)).map((x) => x.name)).toEqual([
			"cast.txt",
		]);
	});

	it("refuses binary text and keeps the error type", async () => {
		const store = open();
		const room = await roomWith(store);
		await expect(
			store.createAttachment({
				roomId: room.id,
				name: "x.txt",
				content: "a\u0000b",
			}),
		).rejects.toBeInstanceOf(ChatAttachmentContentError);
	});

	it("enforces the count and total caps in the store", async () => {
		const store = open();
		const room = await roomWith(store);
		for (let i = 0; i < CHAT_ATTACHMENT_MAX_PER_ROOM; i++)
			await store.createAttachment({
				roomId: room.id,
				name: `${i}.txt`,
				content: "x",
			});
		await expect(
			store.createAttachment({ roomId: room.id, name: "9.txt", content: "x" }),
		).rejects.toMatchObject({ kind: "count" });

		const other = await roomWith(store);
		const half = "가".repeat(CHAT_ATTACHMENT_ROOM_MAX_LENGTH / 2);
		await store.createAttachment({
			roomId: other.id,
			name: "a",
			content: half,
		});
		await store.createAttachment({
			roomId: other.id,
			name: "b",
			content: half,
		});
		const refused = store.createAttachment({
			roomId: other.id,
			name: "c",
			content: "x",
		});
		await expect(refused).rejects.toBeInstanceOf(ChatAttachmentLimitError);
		await expect(refused).rejects.toMatchObject({ kind: "total" });
	});

	it("is not created in a deleted room, and deleting the room removes its files", async () => {
		const store = open();
		const room = await roomWith(store);
		await store.createAttachment({ roomId: room.id, name: "a", content: "x" });
		await store.deleteRoom(room.id);
		expect(await store.listAttachments(room.id)).toEqual([]);
		await expect(
			store.createAttachment({ roomId: room.id, name: "b", content: "y" }),
		).rejects.toBeInstanceOf(ChatRoomMissingError);
	});

	it("a duplicated room carries the files under new ids", async () => {
		const store = open();
		const room = await roomWith(store);
		const original = await store.createAttachment({
			roomId: room.id,
			name: "a.md",
			content: "body",
		});
		const copy = await store.duplicateRoom(room.id, "Copy");
		expect(copy).not.toBeNull();
		const copied = await store.listAttachments(copy?.id ?? "");
		expect(copied).toHaveLength(1);
		expect(copied[0]).toMatchObject({ name: "a.md", content: "body" });
		expect(copied[0]?.id).not.toBe(original.id);
	});
});
