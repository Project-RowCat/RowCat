import type { ChatStore } from "@rowcat/chat";
import { activeUserTools, ChatUserToolError } from "@rowcat/chat";
import type { ChatCustomToolDto } from "@rowcat/contracts/chat";
import { StoryChatSeedDto } from "@rowcat/contracts/chat";
import { compareRev } from "@rowcat/sync";
import { afterEach, describe, expect, it } from "vitest";
import {
	activateLocalDbScope,
	resetLocalDbScope,
} from "#/lib/local-data/db.ts";
import { createChatStore } from "./store.ts";

/**
 * The user tool library and room overrides against real IndexedDB. Types cannot show that the
 * store re-checks a definition instead of trusting the form, that a deleted tool stays invisible
 * and unrevivable, or that clearing the last override deletes the key (one shape for "follow the
 * default", so a two-device round trip is idempotent).
 */

let sequence = 0;
const nextViewer = (label: string): string => `${label}-${++sequence}`;
const open = (viewerId: string): ChatStore =>
	createChatStore(activateLocalDbScope(viewerId));

const template = (name: string, body = "Hello {{who}}"): ChatCustomToolDto => ({
	declaration: {
		name,
		description: "Greets someone.",
		parameters: [
			{
				name: "who",
				type: "string",
				description: "",
				required: true,
				choices: [],
			},
		],
	},
	action: { kind: "template", template: body },
});

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

describe("the tool library", () => {
	it("a created tool is listed, on by default unless asked otherwise", async () => {
		const store = open(nextViewer("alice"));
		const on = await store.createUserTool({ tool: template("greet") });
		const off = await store.createUserTool({
			tool: template("wave"),
			enabledByDefault: false,
		});

		expect(on.enabledByDefault).toBe(true);
		expect(off.enabledByDefault).toBe(false);
		expect((await store.listUserTools()).map((tool) => tool.id).sort()).toEqual(
			[on.id, off.id].sort(),
		);
		expect((await store.getUserTool(on.id))?.tool).toEqual(template("greet"));
	});

	it("the store rejects an invalid definition with its issues, not a rollback error", async () => {
		const store = open(nextViewer("alice"));
		const broken = {
			...template("greet"),
			declaration: { ...template("greet").declaration, description: "" },
		};
		await expect(store.createUserTool({ tool: broken })).rejects.toBeInstanceOf(
			ChatUserToolError,
		);
		await expect(
			store.createUserTool({ tool: template("lore_search") }),
		).rejects.toBeInstanceOf(ChatUserToolError);
		expect(await store.listUserTools()).toEqual([]);
	});

	it("an update is one revision and re-checks the definition", async () => {
		const store = open(nextViewer("alice"));
		const created = await store.createUserTool({ tool: template("greet") });

		await store.updateUserTool(created.id, {
			tool: template("greet", "Hi {{who}}"),
			enabledByDefault: false,
		});
		const updated = await store.getUserTool(created.id);
		expect(updated?.tool.action).toEqual({
			kind: "template",
			template: "Hi {{who}}",
		});
		expect(updated?.enabledByDefault).toBe(false);
		expect(updated && compareRev(updated.rev, created.rev)).toBeGreaterThan(0);

		await expect(
			store.updateUserTool(created.id, {
				tool: {
					...template("greet"),
					action: { kind: "template", template: "" },
				},
			}),
		).rejects.toBeInstanceOf(ChatUserToolError);
	});

	it("deletion hides the tool and no edit revives it", async () => {
		const store = open(nextViewer("alice"));
		const created = await store.createUserTool({ tool: template("greet") });

		await store.deleteUserTool(created.id);
		await store.updateUserTool(created.id, { enabledByDefault: false });
		await store.deleteUserTool(created.id);

		expect(await store.listUserTools()).toEqual([]);
		expect(await store.getUserTool(created.id)).toBeNull();
	});

	it("operations on a missing tool are no-ops", async () => {
		const store = open(nextViewer("alice"));
		await store.updateUserTool("missing", { enabledByDefault: false });
		await store.deleteUserTool("missing");
		expect(await store.listUserTools()).toEqual([]);
	});
});

describe("room overrides", () => {
	it("a room's choice wins over the tool's default, and clearing it deletes the key", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);
		const tool = await store.createUserTool({ tool: template("greet") });

		await store.setRoomToolOverride(room.id, tool.id, false);
		let stored = await store.getRoom(room.id);
		expect(stored?.toolOverrides).toEqual({ [tool.id]: false });
		expect(
			stored && activeUserTools(stored, await store.listUserTools()),
		).toEqual([]);

		await store.setRoomToolOverride(room.id, tool.id, null);
		stored = await store.getRoom(room.id);
		expect(stored && "toolOverrides" in stored).toBe(false);
		expect(
			stored && activeUserTools(stored, await store.listUserTools()),
		).toEqual([template("greet")]);
	});

	it("an override may name a tool this device has not received", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);
		await store.setRoomToolOverride(room.id, "arrives-later", true);
		expect((await store.getRoom(room.id))?.toolOverrides).toEqual({
			"arrives-later": true,
		});
	});

	it("a deleted room is not revived by an override", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);
		await store.deleteRoom(room.id);
		await store.setRoomToolOverride(room.id, "tool", true);
		expect(await store.getRoom(room.id)).toBeNull();
	});

	it("deleting a tool leaves the room's override in place and inert", async () => {
		const store = open(nextViewer("alice"));
		const room = await roomWith(store);
		const tool = await store.createUserTool({ tool: template("greet") });
		await store.setRoomToolOverride(room.id, tool.id, true);

		await store.deleteUserTool(tool.id);

		const stored = await store.getRoom(room.id);
		expect(stored?.toolOverrides).toEqual({ [tool.id]: true });
		expect(
			stored && activeUserTools(stored, await store.listUserTools()),
		).toEqual([]);
	});
});
