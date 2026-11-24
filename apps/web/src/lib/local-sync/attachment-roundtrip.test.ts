import type { ChatSeed } from "@rowcat/chat";
import { CHAT_SEED_VERSION } from "@rowcat/contracts";
import { afterEach, describe, expect, it } from "vitest";
import {
	converge,
	createDevice,
	type Device,
	FakeSyncServer,
} from "#/test/sync-devices.ts";

/**
 * Attachments across two devices (`chat.attachment`). A file attached on one device must be read on
 * the other's turns too, and removing it — or deleting the room — must reach the other device, or
 * that device keeps sending a file the user removed.
 */

const seed = (title: string): ChatSeed => ({
	version: CHAT_SEED_VERSION,
	storyId: "story-1",
	title,
	tagline: "",
	adult: false,
	promptProtected: false,
	scenario: "Scenario",
	firstScene: "",
	playGuide: "",
	persona: null,
	characters: [],
	lore: [],
	startScenes: [],
	sceneImages: [],
	tools: [],
});

let devices: Device[] = [];
const spawn = (server: FakeSyncServer, name: string): Device => {
	const device = createDevice(name, server);
	devices.push(device);
	return device;
};

afterEach(() => {
	for (const device of devices) device.close();
	devices = [];
});

describe("attachments over sync", () => {
	it("a file attached on A arrives at B, and its removal follows", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const room = await a.chat.createRoom({
			originStoryId: null,
			seed: seed("Room"),
		});
		const file = await a.chat.createAttachment({
			roomId: room.id,
			name: "world.md",
			content: "# Harbor\nThe lighthouse keeper sings at night.",
		});
		await converge(a, b);

		const mirrored = await b.chat.listAttachments(room.id);
		expect(mirrored).toHaveLength(1);
		expect(mirrored[0]).toMatchObject({
			id: file.id,
			name: "world.md",
			content: file.content,
		});

		await a.chat.deleteAttachment(file.id);
		await converge(a, b);
		expect(await b.chat.listAttachments(room.id)).toEqual([]);
	});

	it("deleting the room on A removes its files on B (receiving cascade)", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");
		const room = await a.chat.createRoom({
			originStoryId: null,
			seed: seed("Room"),
		});
		await a.chat.createAttachment({
			roomId: room.id,
			name: "a.txt",
			content: "x",
		});
		await converge(a, b);
		await a.chat.deleteRoom(room.id);
		await converge(a, b);
		expect(await b.chat.listAttachments(room.id)).toEqual([]);
	});
});
