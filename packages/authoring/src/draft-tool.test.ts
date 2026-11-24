import { CHAT_MAX_TOOLS } from "@rowcat/contracts/chat";
import { STORY_PUBLISH_LIMITS } from "@rowcat/contracts/publication";
import type { Rev } from "@rowcat/contracts/sync";
import { describe, expect, it } from "vitest";
import {
	checkDraftTool,
	createDraftToolRecord,
	DRAFT_TOOL_ISSUE_CODES,
	DRAFT_TOOL_LIMITS,
	DRAFT_TOOL_RESERVED_NAMES,
	type DraftTool,
	draftToolImportBlock,
	draftToolIssueSentence,
	draftToolMethod,
	draftToolUrl,
	newDraftToolOf,
	sortDraftTools,
	toCreatorTool,
} from "./draft-tool.ts";
import {
	AUTHORING_SCHEMA_VERSION,
	createStoryDraftRecord,
	markAuthoringDeleted,
} from "./model.ts";
import {
	buildStoryPublication,
	prepareStoryPublication,
} from "./publication.ts";
import { draftToolSyncCodec } from "./sync-codec.ts";
import { PUBLICATION_ISSUE_CODE } from "./validation.ts";

/**
 * Creator tools from the record to the published seed. The record is loose on purpose (a tool being
 * written is usually invalid), so what is pinned here is the narrowing: what publishing keeps, what
 * it drops, and that the editor's check and the server's contract are one rule.
 */

const NOW = "2026-01-01T00:00:00.000Z";
const REV: Rev = { t: 1_767_225_600_000, c: 0, d: "test-device" };
const stamp = (id: string) => ({ id, now: NOW, rev: REV });

const tool = (
	id: string,
	input: Partial<Parameters<typeof createDraftToolRecord>[0]> = {},
): DraftTool =>
	createDraftToolRecord(
		{
			draftId: "draft-1",
			positionIndex: 0,
			name: "harbor_weather",
			description: "The weather at a place in the harbor city.",
			template: "Rain over {{place}}.",
			...input,
		},
		stamp(id),
	);

const draft = () =>
	createStoryDraftRecord(
		{ title: "The Night Library", prompt: "A library where books talk." },
		stamp("draft-1"),
	);

const source = (tools: DraftTool[] | undefined) => ({
	draft: draft(),
	lore: [],
	startScenes: [],
	sceneImages: [],
	tools,
});

describe("the record", () => {
	it("starts as an empty template with every kind's fields side by side", () => {
		const record = createDraftToolRecord(
			{ draftId: "draft-1", positionIndex: 3 },
			stamp("tool-1"),
		);
		expect(record).toMatchObject({
			id: "tool-1",
			draftId: "draft-1",
			positionIndex: 3,
			name: "",
			description: "",
			parameters: [],
			kind: "template",
			template: "",
			entries: [],
			draws: 1,
			system: "",
			maxOutputTokens: 1_024,
			deletedAt: null,
			dirty: 1,
		});
	});

	it("sorts by position, then id", () => {
		const sorted = sortDraftTools([
			tool("b", { positionIndex: 1 }),
			tool("c", { positionIndex: 0 }),
			tool("a", { positionIndex: 1 }),
		]);
		expect(sorted.map((entry) => entry.id)).toEqual(["c", "a", "b"]);
	});
});

describe("narrowing to the published shape", () => {
	it("trims, keeps only the chosen kind's action, and drops empty table rows", () => {
		const record = tool("t", {
			name: "  dice ",
			description: " Rolls. ",
			kind: "table",
			template: "kept on the record, not published",
			entries: [" one ", "", "  ", "two"],
			draws: 2,
		});
		expect(toCreatorTool(record)).toEqual({
			declaration: { name: "dice", description: "Rolls.", parameters: [] },
			action: { kind: "table", entries: ["one", "two"], draws: 2 },
		});
		// Switching kinds loses nothing on the record.
		expect(record.template).toBe("kept on the record, not published");
	});

	it("keeps choices only for string parameters, trimmed and without blanks", () => {
		const record = tool("t", {
			parameters: [
				{
					name: " place ",
					type: "string",
					description: " Where. ",
					required: true,
					choices: [" pier", "", " market "],
				},
				{
					name: "count",
					type: "number",
					description: "",
					required: false,
					choices: ["stale"],
				},
			],
		});
		expect(toCreatorTool(record).declaration.parameters).toEqual([
			{
				name: "place",
				type: "string",
				description: "Where.",
				required: true,
				choices: ["pier", "market"],
			},
			{
				name: "count",
				type: "number",
				description: "",
				required: false,
				choices: [],
			},
		]);
	});

	it("an agent publishes its system prompt and output cap", () => {
		expect(
			toCreatorTool(
				tool("t", {
					kind: "agent",
					system: " You are the oracle. ",
					maxOutputTokens: 300,
				}),
			).action,
		).toEqual({
			kind: "agent",
			system: "You are the oracle.",
			maxOutputTokens: 300,
		});
	});
});

describe("checking a tool", () => {
	it("accepts a complete tool of each kind", () => {
		expect(checkDraftTool(tool("t")).ok).toBe(true);
		expect(
			checkDraftTool(tool("t", { kind: "table", entries: ["a"], draws: 1 })).ok,
		).toBe(true);
		expect(
			checkDraftTool(
				tool("t", { kind: "agent", system: "You are the oracle." }),
			).ok,
		).toBe(true);
	});

	it("names each missing piece by path", () => {
		const checked = checkDraftTool(
			tool("t", { name: "Bad Name", description: "", template: "" }),
		);
		expect(checked.ok).toBe(false);
		if (checked.ok) return;
		expect(checked.issues).toEqual([
			{ code: "name_invalid" },
			{ code: "description_required" },
			{ code: "template_required" },
		]);
	});

	it("rejects an empty table, too many draws, and an agent over its cap", () => {
		expect(
			checkDraftTool(tool("t", { kind: "table", entries: [" "] })).ok,
		).toBe(false);
		expect(
			checkDraftTool(
				tool("t", {
					kind: "table",
					entries: ["a"],
					draws: DRAFT_TOOL_LIMITS.tableMaxDraws + 1,
				}),
			).ok,
		).toBe(false);
		expect(
			checkDraftTool(
				tool("t", {
					kind: "agent",
					system: "x",
					maxOutputTokens: DRAFT_TOOL_LIMITS.agentMaxOutputTokens + 1,
				}),
			).ok,
		).toBe(false);
	});

	it("rejects repeated parameter names", () => {
		const parameter = {
			name: "place",
			type: "string" as const,
			description: "",
			required: false,
			choices: [],
		};
		expect(
			checkDraftTool(tool("t", { parameters: [parameter, parameter] })).ok,
		).toBe(false);
	});
});

describe("issue codes", () => {
	it("names the parameter row and tells too big from missing", () => {
		const checked = checkDraftTool(
			tool("t", {
				kind: "agent",
				system: "",
				maxOutputTokens: DRAFT_TOOL_LIMITS.agentMaxOutputTokens + 1,
				parameters: [
					{
						name: "ok",
						type: "string",
						description: "",
						required: false,
						choices: [],
					},
					{
						name: "Bad",
						type: "string",
						description: "",
						required: false,
						choices: [],
					},
				],
			}),
		);
		expect(checked.ok ? [] : checked.issues).toEqual([
			{ code: "parameter_name_invalid", parameter: 2 },
			{ code: "system_required" },
			{ code: "max_output_tokens_out_of_range" },
		]);
		expect(
			checkDraftTool(
				tool("t", {
					template: "x".repeat(DRAFT_TOOL_LIMITS.templateChars + 1),
				}),
			),
		).toEqual({ ok: false, issues: [{ code: "template_too_long" }] });
	});

	it("reports a reserved name on the card, before publishing", () => {
		expect(checkDraftTool(tool("t", { name: "lore_search" }))).toEqual({
			ok: false,
			issues: [{ code: "name_reserved" }],
		});
	});

	it("every code has an English sentence without schema vocabulary", () => {
		for (const code of DRAFT_TOOL_ISSUE_CODES) {
			const sentence = draftToolIssueSentence({ code, parameter: 1 });
			expect(sentence).not.toMatch(/declaration|action\.|expected/);
			expect(sentence.length).toBeGreaterThan(0);
		}
	});
});

describe("between a user's library and a draft", () => {
	it("a library tool becomes a draft tool that publishes the same definition", () => {
		const library = {
			declaration: {
				name: "advisor",
				description: "Ask a seasoned advisor.",
				parameters: [
					{
						name: "worry",
						type: "string" as const,
						description: "",
						required: true,
						choices: [],
					},
				],
			},
			action: {
				kind: "agent" as const,
				system: "Be brief.",
				maxOutputTokens: 300,
			},
		};
		const input = newDraftToolOf(library);
		expect(input).not.toBeNull();
		const draft = createDraftToolRecord(
			{ draftId: "draft-1", positionIndex: 0, ...input },
			stamp("t"),
		);
		expect(checkDraftTool(draft)).toEqual({ ok: true, tool: library });
	});

	it("a localhost http tool with no headers copies into a draft and publishes as it was", () => {
		const library = {
			declaration: { name: "hook", description: "x", parameters: [] },
			action: {
				kind: "http" as const,
				url: "http://localhost:8787/hook",
				method: "GET" as const,
				headers: [],
			},
		};
		expect(draftToolImportBlock(library)).toBeNull();
		const input = newDraftToolOf(library);
		expect(input).not.toBeNull();
		const draft = createDraftToolRecord(
			{ draftId: "draft-1", positionIndex: 0, ...input },
			stamp("t"),
		);
		expect(checkDraftTool(draft)).toEqual({ ok: true, tool: library });
	});

	it("an http tool with headers stays out, and says why", () => {
		const library = {
			declaration: { name: "hook", description: "x", parameters: [] },
			action: {
				kind: "http" as const,
				url: "http://localhost:8787/hook",
				method: "POST" as const,
				headers: [{ name: "Authorization", value: "secret" }],
			},
		};
		expect(newDraftToolOf(library)).toBeNull();
		expect(draftToolImportBlock(library)).toBe("http_headers");
	});

	it("an http tool off localhost has no draft form", () => {
		expect(
			newDraftToolOf({
				declaration: { name: "hook", description: "x", parameters: [] },
				action: {
					kind: "http",
					url: "https://example.test",
					method: "POST",
					headers: [],
				},
			}),
		).toBeNull();
	});
});

describe("the creator's http tool", () => {
	it("publishes a loopback address with no headers", () => {
		const checked = checkDraftTool(
			tool("t", {
				kind: "http",
				url: " http://127.0.0.1:3000/x ",
				method: "GET",
			}),
		);
		expect(checked).toEqual({
			ok: true,
			tool: expect.objectContaining({
				action: {
					kind: "http",
					url: "http://127.0.0.1:3000/x",
					method: "GET",
					headers: [],
				},
			}),
		});
	});

	it("asks for an address when there is none, and refuses one off the reader's machine", () => {
		expect(checkDraftTool(tool("t", { kind: "http" }))).toEqual({
			ok: false,
			issues: [{ code: "url_required" }],
		});
		expect(
			checkDraftTool(
				tool("t", { kind: "http", url: "https://example.com/hook" }),
			),
		).toEqual({ ok: false, issues: [{ code: "url_not_local" }] });
	});

	it("reads a record from before this kind as an empty address and POST", () => {
		const { url: _url, method: _method, ...rest } = tool("t");
		const old: DraftTool = rest;
		expect(draftToolUrl(old)).toBe("");
		expect(draftToolMethod(old)).toBe("POST");
	});

	it("syncs the address and method, and decodes a payload without them", () => {
		const record = tool("t", {
			kind: "http",
			url: "http://localhost:8787",
			method: "GET",
		});
		const data = draftToolSyncCodec.encode(record) as Record<string, unknown>;
		const decoded = draftToolSyncCodec.decode({
			id: "t",
			schemaVersion: AUTHORING_SCHEMA_VERSION,
			rev: REV,
			deletedAt: null,
			data,
		});
		expect(decoded?.url).toBe("http://localhost:8787");
		expect(decoded?.method).toBe("GET");
		const { url: _url, method: _method, ...older } = data;
		const decodedOld = draftToolSyncCodec.decode({
			id: "t",
			schemaVersion: AUTHORING_SCHEMA_VERSION,
			rev: REV,
			deletedAt: null,
			data: older,
		});
		expect(decodedOld).not.toBeNull();
		expect(decodedOld && draftToolUrl(decodedOld)).toBe("");
	});
});

describe("publishing tools", () => {
	it("publishes valid tools in list order, and a caller that does not know tools publishes none", () => {
		const prepared = prepareStoryPublication(
			source([
				tool("b", { positionIndex: 1, name: "second" }),
				tool("a", { positionIndex: 0, name: "first" }),
			]),
		);
		expect(
			prepared.publication.play.tools.map((entry) => entry.declaration.name),
		).toEqual(["first", "second"]);
		expect(prepared.toolIssues).toEqual([]);

		expect(
			prepareStoryPublication(source(undefined)).publication.play.tools,
		).toEqual([]);
	});

	it("leaves deleted tools out", () => {
		const deleted = markAuthoringDeleted(tool("a"), NOW, REV);
		expect(
			prepareStoryPublication(source([deleted])).publication.play.tools,
		).toEqual([]);
	});

	it("drops an invalid tool from the play payload and blocks publishing with its issue", () => {
		const prepared = prepareStoryPublication(
			source([
				tool("a", { positionIndex: 0 }),
				tool("b", { positionIndex: 1, name: "half_written", description: "" }),
			]),
		);
		expect(
			prepared.publication.play.tools.map((entry) => entry.declaration.name),
		).toEqual(["harbor_weather"]);
		expect(prepared.toolIssues).toEqual([
			expect.objectContaining({ index: 1, name: "half_written" }),
		]);

		const built = buildStoryPublication(
			source([
				tool("a", { positionIndex: 0 }),
				tool("b", { positionIndex: 1, name: "half_written", description: "" }),
			]),
		);
		expect(built.ok).toBe(false);
		expect(built.issues).toContainEqual(
			expect.objectContaining({
				field: "tools.1",
				code: PUBLICATION_ISSUE_CODE.invalidTool,
			}),
		);
	});

	it("a repeated name keeps the first and reports the second", () => {
		const prepared = prepareStoryPublication(
			source([
				tool("a", { positionIndex: 0, template: "first" }),
				tool("b", { positionIndex: 1, template: "second" }),
			]),
		);
		expect(prepared.publication.play.tools).toHaveLength(1);
		expect(prepared.publication.play.tools[0]?.action).toEqual({
			kind: "template",
			template: "first",
		});
		expect(prepared.toolIssues).toEqual([
			expect.objectContaining({ index: 1 }),
		]);
	});

	it("a reserved name is reported, because lore search would win it in every room", () => {
		for (const name of DRAFT_TOOL_RESERVED_NAMES) {
			const prepared = prepareStoryPublication(source([tool("a", { name })]));
			expect(prepared.publication.play.tools).toEqual([]);
			expect(prepared.toolIssues).toHaveLength(1);
		}
	});

	it("the publish cap equals the playback cap", () => {
		expect(STORY_PUBLISH_LIMITS.tools).toBe(CHAT_MAX_TOOLS);
	});
});

describe("the tool sync codec", () => {
	it("round-trips a tool mid-edit, every kind's fields included", () => {
		const record: DraftTool = {
			...tool("tool-1", {
				kind: "agent",
				description: "",
				parameters: [
					{
						name: "q",
						type: "string",
						description: "Question",
						required: true,
						choices: ["a", ""],
					},
				],
				entries: ["row"],
				draws: 3,
				system: "You are the oracle.",
				maxOutputTokens: 200,
			}),
			dirty: 0,
			serverVersion: 0,
		};
		expect(
			draftToolSyncCodec.decode({
				id: "tool-1",
				schemaVersion: AUTHORING_SCHEMA_VERSION,
				rev: record.rev,
				deletedAt: null,
				data: draftToolSyncCodec.encode(record),
			}),
		).toEqual(record);
	});

	it("does not apply a kind this device does not know", () => {
		const data = draftToolSyncCodec.encode(tool("t")) as Record<
			string,
			unknown
		>;
		expect(
			draftToolSyncCodec.decode({
				id: "t",
				schemaVersion: AUTHORING_SCHEMA_VERSION,
				rev: REV,
				deletedAt: null,
				data: { ...data, kind: "script" },
			}),
		).toBeNull();
	});

	it("last writer wins as a whole record", () => {
		const local = {
			...tool("t", { template: "local" }),
			rev: { ...REV, t: 1 },
		};
		const remote = {
			...tool("t", { template: "remote" }),
			rev: { ...REV, t: 2 },
		};
		expect(draftToolSyncCodec.merge(local, remote).record.template).toBe(
			"remote",
		);
		expect(draftToolSyncCodec.merge(remote, local).record.template).toBe(
			"remote",
		);
	});
});
