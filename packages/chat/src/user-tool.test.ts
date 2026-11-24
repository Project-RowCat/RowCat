import type { ChatCustomToolDto } from "@rowcat/contracts/chat";
import { describe, expect, it } from "vitest";
import { chatUserToolSyncCodec } from "./sync-codec.ts";
import { CHAT_LORE_TOOL_NAME } from "./tool-lore.ts";
import {
	activeUserTools,
	applyRoomToolOverride,
	applyRoomToolOverrides,
	type ChatUserTool,
	ChatUserToolError,
	checkUserToolDefinition,
	createUserToolRecord,
	roomToolOverrides,
	userToolActiveIn,
	userToolNameTaken,
} from "./user-tool.ts";

/**
 * What the user tool library must guarantee:
 * - A definition is valid by the contract's own schema, and the built-in name is not takeable.
 * - A room's choice beats the tool's default, and "no overrides" has one shape.
 * - The sync codec drops a definition this device cannot run instead of storing it half-read.
 */

const definition = (
	name = "dice",
	over: Partial<ChatCustomToolDto> = {},
): ChatCustomToolDto => ({
	declaration: { name, description: "주사위", parameters: [] },
	action: { kind: "table", entries: ["1", "2"], draws: 1 },
	...over,
});

const stamp = (id: string, now = "2026-11-24T00:00:00.000Z") => ({
	id,
	now,
	rev: { t: 1, c: 0, d: "device-a" },
});

const record = (
	id: string,
	over: Partial<ChatUserTool> = {},
): ChatUserTool => ({
	...createUserToolRecord(
		{ tool: definition(id.replace(/-/g, "_")) },
		stamp(id),
	),
	...over,
});

describe("definitions", () => {
	it("accepts a valid definition and fills contract defaults", () => {
		const checked = checkUserToolDefinition({
			declaration: { name: "note", description: "메모" },
			action: { kind: "template", template: "x" },
		});
		expect(checked.ok && checked.tool.declaration.parameters).toEqual([]);
	});

	it("rejects the built-in lore search name", () => {
		const checked = checkUserToolDefinition(definition(CHAT_LORE_TOOL_NAME));
		expect(checked.ok).toBe(false);
	});

	it("reports issues with their path", () => {
		const checked = checkUserToolDefinition(
			definition("x", {
				action: {
					kind: "http",
					url: "ftp://nope",
					method: "POST",
					headers: [],
				},
			}),
		);
		expect(checked.ok).toBe(false);
		if (!checked.ok) expect(checked.issues[0]).toMatch(/^action\.url: /);
	});

	it("the factory re-checks and defaults to on everywhere", () => {
		expect(() =>
			createUserToolRecord({ tool: definition("Bad Name") }, stamp("a")),
		).toThrow(ChatUserToolError);
		expect(record("a").enabledByDefault).toBe(true);
	});

	it("finds a name taken by another live tool only", () => {
		const tools = [record("a"), record("b", { deletedAt: "2026-11-25" })];
		expect(userToolNameTaken(tools, "a")).toBe(true);
		expect(userToolNameTaken(tools, "a", "a")).toBe(false);
		expect(userToolNameTaken(tools, "b")).toBe(false);
	});
});

describe("room overrides", () => {
	it("the room's choice wins over the tool default", () => {
		const off = record("a");
		const optIn = record("b", { enabledByDefault: false });
		const room = applyRoomToolOverride(
			applyRoomToolOverride({}, "a", false),
			"b",
			true,
		);
		expect(userToolActiveIn(room, off)).toBe(false);
		expect(userToolActiveIn(room, optIn)).toBe(true);
		expect(userToolActiveIn({}, off)).toBe(true);
	});

	it("clearing the last override removes the key", () => {
		const room = applyRoomToolOverride(
			applyRoomToolOverride(
				{ title: "t" } as {
					title: string;
					toolOverrides?: Record<string, boolean>;
				},
				"a",
				false,
			),
			"a",
			null,
		);
		expect(room).toEqual({ title: "t" });
		expect(roomToolOverrides(room)).toEqual({});
		expect(applyRoomToolOverrides({ toolOverrides: {} }, {})).toEqual({});
	});

	it("lists active definitions in library order, skipping deleted ones", () => {
		const tools = [
			record("old", { updatedAt: "2026-11-01" }),
			record("new", { updatedAt: "2026-11-20" }),
			record("gone", { deletedAt: "2026-11-21" }),
			record("off", { enabledByDefault: false }),
		];
		expect(
			activeUserTools({}, tools).map((tool) => tool.declaration.name),
		).toEqual(["new", "old"]);
	});
});

describe("chat.tool codec", () => {
	const input = (data: unknown) => ({
		id: "tool-1",
		schemaVersion: 1,
		rev: { t: 2, c: 0, d: "device-b" },
		deletedAt: null,
		data,
	});

	it("round trips a record", () => {
		const original = record("tool-1");
		const decoded = chatUserToolSyncCodec.decode(
			input(chatUserToolSyncCodec.encode(original)),
		);
		expect(decoded).toEqual({
			...original,
			rev: { t: 2, c: 0, d: "device-b" },
			dirty: 0,
			serverVersion: 0,
		});
	});

	it("drops an action kind this device does not know", () => {
		const payload = chatUserToolSyncCodec.encode(record("tool-1")) as {
			tool: ChatCustomToolDto;
		};
		expect(
			chatUserToolSyncCodec.decode(
				input({
					...payload,
					tool: { ...payload.tool, action: { kind: "script", code: "x" } },
				}),
			),
		).toBeNull();
	});

	it("drops a reserved name", () => {
		const payload = chatUserToolSyncCodec.encode(record("tool-1")) as Record<
			string,
			unknown
		>;
		expect(
			chatUserToolSyncCodec.decode(
				input({ ...payload, tool: definition(CHAT_LORE_TOOL_NAME) }),
			),
		).toBeNull();
	});
});
