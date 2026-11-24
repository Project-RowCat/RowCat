import type { ChatSeed } from "@rowcat/chat";
import { activeUserTools } from "@rowcat/chat";
import { CHAT_SEED_VERSION } from "@rowcat/contracts";
import type { ChatCustomToolDto } from "@rowcat/contracts/chat";
import { afterEach, describe, expect, it } from "vitest";
import {
	converge,
	createDevice,
	type Device,
	FakeSyncServer,
} from "#/test/sync-devices.ts";

/**
 * Two-device round trip for user tools (`chat.tool`) and the room's `toolOverrides`.
 *
 * What only a round trip shows: an `http` tool's header values (usually a key) survive the
 * encrypted record on the other device, a deletion propagates and is not revived, and the room's
 * override is a reference by id, so deleting the tool leaves the room's map in place but inert on
 * both devices.
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

const httpTool: ChatCustomToolDto = {
	declaration: {
		name: "weather",
		description: "Looks up the weather for a city.",
		parameters: [
			{
				name: "city",
				type: "string",
				description: "City name.",
				required: true,
				choices: [],
			},
		],
	},
	action: {
		kind: "http",
		url: "https://example.test/weather",
		method: "POST",
		headers: [{ name: "Authorization", value: "Bearer secret" }],
	},
};

const agentTool: ChatCustomToolDto = {
	declaration: {
		name: "critic",
		description: "Reviews a draft line.",
		parameters: [],
	},
	action: {
		kind: "agent",
		system: "You are a terse critic.",
		maxOutputTokens: 256,
	},
};

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

describe("library propagation", () => {
	it("a tool A made arrives at B whole, header values included", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");

		const created = await a.chat.createUserTool({
			tool: httpTool,
			enabledByDefault: false,
		});
		await converge(a, b);

		const mirrored = await b.chat.listUserTools();
		expect(mirrored).toHaveLength(1);
		expect(mirrored[0]).toMatchObject({
			id: created.id,
			tool: httpTool,
			enabledByDefault: false,
		});
	});

	it("edits converge", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");

		const created = await a.chat.createUserTool({ tool: agentTool });
		await converge(a, b);

		await b.chat.updateUserTool(created.id, { enabledByDefault: false });
		await converge(a, b);

		expect((await a.chat.getUserTool(created.id))?.enabledByDefault).toBe(
			false,
		);
	});

	it("deletion propagates and nothing revives", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");

		const created = await a.chat.createUserTool({ tool: agentTool });
		await converge(a, b);

		await a.chat.deleteUserTool(created.id);
		await converge(a, b);
		await converge(a, b);

		expect(await a.chat.listUserTools()).toEqual([]);
		expect(await b.chat.listUserTools()).toEqual([]);
	});
});

describe("room overrides", () => {
	it("an override set on A applies on B, and clearing it propagates as an absent key", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");

		const room = await a.chat.createRoom({
			originStoryId: null,
			seed: seed("Tool conversation"),
		});
		const tool = await a.chat.createUserTool({ tool: agentTool });
		await a.chat.setRoomToolOverride(room.id, tool.id, false);
		await converge(a, b);

		const mirrored = await b.chat.getRoom(room.id);
		expect(mirrored?.toolOverrides).toEqual({ [tool.id]: false });
		expect(
			mirrored && activeUserTools(mirrored, await b.chat.listUserTools()),
		).toEqual([]);

		await b.chat.setRoomToolOverride(room.id, tool.id, null);
		await converge(a, b);

		const cleared = await a.chat.getRoom(room.id);
		expect(cleared && "toolOverrides" in cleared).toBe(false);
		expect(
			cleared && activeUserTools(cleared, await a.chat.listUserTools()),
		).toEqual([agentTool]);
	});

	it("deleting the tool leaves the room's override in place and inert on both devices", async () => {
		const server = new FakeSyncServer();
		const a = spawn(server, "a");
		const b = spawn(server, "b");

		const room = await a.chat.createRoom({
			originStoryId: null,
			seed: seed("Tool conversation"),
		});
		const tool = await a.chat.createUserTool({ tool: agentTool });
		await a.chat.setRoomToolOverride(room.id, tool.id, true);
		await converge(a, b);

		await b.chat.deleteUserTool(tool.id);
		await converge(a, b);

		for (const device of [a, b]) {
			const stored = await device.chat.getRoom(room.id);
			expect(stored?.toolOverrides).toEqual({ [tool.id]: true });
			expect(
				stored && activeUserTools(stored, await device.chat.listUserTools()),
			).toEqual([]);
		}
	});
});
