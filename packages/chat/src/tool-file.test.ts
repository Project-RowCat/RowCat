import type { ChatCustomToolDto } from "@rowcat/contracts/chat";
import { describe, expect, it } from "vitest";
import {
	buildChatToolFile,
	CHAT_TOOL_FILE_FORMAT,
	CHAT_TOOL_FILE_LIMITS,
	CHAT_TOOL_FILE_VERSION,
	type ChatToolFileEntry,
	chatToolFileName,
	chatToolFileTooLarge,
	chatToolImportChoices,
	chatToolImportWrites,
	planChatToolImport,
	readChatToolFile,
	serializeChatToolFile,
} from "./tool-file.ts";
import { type ChatUserTool, createUserToolRecord } from "./user-tool.ts";

/**
 * Tool files. Three promises are checked: a credential never leaves through the file, an imported
 * tool never acts on arrival (off, and never over an existing tool unless the importer says so),
 * and a file round-trips through the same gate the settings form uses.
 */

const REV = { t: 1_767_225_600_000, c: 0, d: "test-device" };

const template = (name: string, body = "hello {{who}}"): ChatCustomToolDto =>
	({
		declaration: {
			name,
			description: `${name} tool`,
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
	}) as ChatCustomToolDto;

const http = (
	name: string,
	url = "https://tools.example.org/roll?x=1",
	value = "Bearer secret-key",
): ChatCustomToolDto =>
	({
		declaration: {
			name,
			description: `${name} tool`,
			parameters: [],
		},
		action: {
			kind: "http",
			url,
			method: "POST",
			headers: [
				{ name: "Authorization", value },
				{ name: "X-Public", value: "" },
			],
		},
	}) as ChatCustomToolDto;

let seq = 0;
const record = (
	tool: ChatCustomToolDto,
	enabledByDefault = true,
): ChatUserTool =>
	createUserToolRecord(
		{ tool, enabledByDefault },
		{ id: `tool-${++seq}`, now: "2026-11-24T00:00:00.000Z", rev: REV },
	);

const roundTrip = (tools: ChatCustomToolDto[]) =>
	readChatToolFile(serializeChatToolFile(buildChatToolFile(tools).file));

const okEntries = (text: string): ChatToolFileEntry[] => {
	const read = readChatToolFile(text);
	if (!read.ok) throw new Error(`unexpected failure: ${read.reason}`);
	return read.entries;
};

describe("export", () => {
	it("never writes header values, and says which ones it left out", () => {
		const { file, strippedHeaders } = buildChatToolFile([http("roll")]);
		const text = serializeChatToolFile(file);
		expect(text).not.toContain("secret-key");
		expect(strippedHeaders).toEqual([
			{ tool: "roll", header: "Authorization" },
		]);
		const action = file.tools[0]?.action;
		expect(action?.kind === "http" && action.headers).toEqual([
			{ name: "Authorization", value: "" },
			{ name: "X-Public", value: "" },
		]);
	});

	it("does not touch the caller's tools", () => {
		const tool = http("roll");
		buildChatToolFile([tool]);
		expect(tool.action.kind === "http" && tool.action.headers[0]?.value).toBe(
			"Bearer secret-key",
		);
	});

	it("names the file after a single tool, or by count", () => {
		expect(chatToolFileName([template("dice")])).toBe("dice.rowcat-tools.json");
		expect(chatToolFileName([template("a"), template("b")])).toBe(
			"rowcat-tools-2.rowcat-tools.json",
		);
	});
});

describe("read", () => {
	it("round-trips through the form's gate", () => {
		const read = roundTrip([template("dice"), http("roll")]);
		expect(read.ok).toBe(true);
		if (!read.ok) return;
		expect(read.entries.map((entry) => entry.ok)).toEqual([true, true]);
		expect(read.entries[1]).toMatchObject({
			http: {
				origin: "https://tools.example.org",
				headersToFill: ["Authorization", "X-Public"],
			},
		});
		expect(read.entries[0]).toMatchObject({ http: null });
	});

	it("answers 'not ours' before anything else", () => {
		expect(readChatToolFile("not json")).toEqual({
			ok: false,
			reason: "not_tool_file",
		});
		expect(
			readChatToolFile(JSON.stringify({ format: "rowcat-story", version: 1 })),
		).toEqual({ ok: false, reason: "not_tool_file" });
		expect(readChatToolFile("[]")).toEqual({
			ok: false,
			reason: "not_tool_file",
		});
	});

	it("reports a newer file as newer, even when its shape is unknown", () => {
		const read = readChatToolFile(
			JSON.stringify({
				format: CHAT_TOOL_FILE_FORMAT,
				version: 99,
				stuff: true,
			}),
		);
		expect(read).toMatchObject({ ok: false, reason: "newer_version" });
	});

	it("refuses an empty or oversized envelope", () => {
		const envelope = (tools: unknown) =>
			JSON.stringify({
				format: CHAT_TOOL_FILE_FORMAT,
				version: CHAT_TOOL_FILE_VERSION,
				tools,
			});
		expect(readChatToolFile(envelope([]))).toMatchObject({ reason: "invalid" });
		expect(readChatToolFile(envelope("x"))).toMatchObject({
			reason: "invalid",
		});
		expect(
			readChatToolFile(
				envelope(
					Array.from({ length: CHAT_TOOL_FILE_LIMITS.tools + 1 }, () => ({})),
				),
			),
		).toMatchObject({ reason: "invalid" });
	});

	it("refuses too-large text before parsing it", () => {
		expect(
			readChatToolFile(" ".repeat(CHAT_TOOL_FILE_LIMITS.bytes + 1)),
		).toEqual({
			ok: false,
			reason: "too_large",
		});
		expect(chatToolFileTooLarge(CHAT_TOOL_FILE_LIMITS.bytes)).toBe(false);
		expect(chatToolFileTooLarge(CHAT_TOOL_FILE_LIMITS.bytes + 1)).toBe(true);
	});

	it("keeps good tools when one entry is broken", () => {
		const text = JSON.stringify({
			format: CHAT_TOOL_FILE_FORMAT,
			version: CHAT_TOOL_FILE_VERSION,
			tools: [
				template("dice"),
				{
					declaration: { name: "broken" },
					action: { kind: "shell", command: "rm" },
				},
				template("lore_search"),
			],
		});
		const entries = okEntries(text);
		expect(entries[0]?.ok).toBe(true);
		expect(entries[1]).toMatchObject({ ok: false, name: "broken" });
		// Reserved names fail the same way the settings form fails them.
		expect(entries[2]).toMatchObject({ ok: false, name: "lore_search" });
	});
});

describe("plan and writes", () => {
	it("imports new tools switched off, and never preselects a replacement", () => {
		const existing = record(template("dice", "old"), true);
		const entries = okEntries(
			serializeChatToolFile(
				buildChatToolFile([template("dice", "new"), template("coin")]).file,
			),
		);
		const plan = planChatToolImport(entries, [existing]);
		expect(plan.map((item) => item.status)).toEqual(["name_taken", "new"]);
		expect(plan[0]?.existingId).toBe(existing.id);

		const writes = chatToolImportWrites(plan, [existing]);
		expect(writes.replace).toEqual([]);
		expect(writes.create).toEqual([
			{ tool: template("coin"), enabledByDefault: false },
		]);
	});

	it("replaces only when the importer chooses it", () => {
		const existing = record(template("dice", "old"));
		const plan = planChatToolImport(
			okEntries(
				serializeChatToolFile(
					buildChatToolFile([template("dice", "new")]).file,
				),
			),
			[existing],
		);
		const writes = chatToolImportWrites(plan, [existing], { 0: "replace" });
		expect(writes.create).toEqual([]);
		expect(writes.replace).toEqual([
			{ id: existing.id, tool: template("dice", "new") },
		]);
	});

	it("ignores a choice the item does not allow", () => {
		const plan = planChatToolImport(
			okEntries(
				serializeChatToolFile(buildChatToolFile([template("coin")]).file),
			),
			[],
		);
		expect(plan.map(chatToolImportChoices)).toEqual([["import", "skip"]]);
		expect(chatToolImportWrites(plan, [], { 0: "replace" })).toEqual({
			create: [],
			replace: [],
		});
	});

	it("deleted library tools do not take a name", () => {
		const deleted = {
			...record(template("dice")),
			deletedAt: "2026-11-24T01:00:00.000Z",
		};
		const plan = planChatToolImport(
			okEntries(
				serializeChatToolFile(buildChatToolFile([template("dice")]).file),
			),
			[deleted],
		);
		expect(plan[0]?.status).toBe("new");
	});

	it("never imports the second of two same-named entries", () => {
		const plan = planChatToolImport(
			okEntries(
				serializeChatToolFile(
					buildChatToolFile([template("dice", "a"), template("dice", "b")])
						.file,
				),
			),
			[],
		);
		expect(plan.map((item) => item.status)).toEqual([
			"new",
			"duplicate_in_file",
		]);
		expect(chatToolImportWrites(plan, [], { 1: "import" }).create).toHaveLength(
			1,
		);
	});

	it("keeps the importer's header value when replacing a tool at the same URL", () => {
		const existing = record(http("roll", undefined, "Bearer mine"));
		const plan = planChatToolImport(
			okEntries(serializeChatToolFile(buildChatToolFile([http("roll")]).file)),
			[existing],
		);
		const [replaced] = chatToolImportWrites(plan, [existing], {
			0: "replace",
		}).replace;
		expect(
			replaced?.tool.action.kind === "http" && replaced.tool.action.headers,
		).toEqual([
			{ name: "Authorization", value: "Bearer mine" },
			{ name: "X-Public", value: "" },
		]);
	});

	it("drops the importer's header value when the replacement calls another URL", () => {
		const existing = record(http("roll", undefined, "Bearer mine"));
		const plan = planChatToolImport(
			okEntries(
				serializeChatToolFile(
					buildChatToolFile([
						http("roll", "https://elsewhere.example.net/hook"),
					]).file,
				),
			),
			[existing],
		);
		const [replaced] = chatToolImportWrites(plan, [existing], {
			0: "replace",
		}).replace;
		const headers =
			replaced?.tool.action.kind === "http" ? replaced.tool.action.headers : [];
		expect(headers.every((header) => header.value === "")).toBe(true);
	});
});
