import {
	type ChatToolImportItem,
	type ChatUserTool,
	freshChatSyncMeta,
} from "@rowcat/chat";
import type { ChatCustomToolDto } from "@rowcat/contracts/chat";
import { describe, expect, it } from "vitest";
import {
	importItemName,
	importReachLines,
	importStatusLine,
	strippedHeadersNotice,
	toolFileFailureMessage,
} from "./tool-file-copy.ts";
import {
	emptyHeaderDraft,
	emptyParameterDraft,
	emptyToolDraft,
	planToolSave,
	type ToolDraft,
	toolDefinitionOf,
	toolDraftOf,
	toolFormIssueOf,
} from "./tool-form.ts";

/**
 * The editor's model without a screen: the draft ↔ definition round trip, which field a problem
 * belongs to, and when a save writes nothing. Plus the tool-file sentences.
 */

const REV = { t: 1, c: 0, d: "device" };

const record = (
	tool: ChatCustomToolDto,
	overrides: Partial<ChatUserTool> = {},
): ChatUserTool => ({
	id: "tool-1",
	tool,
	enabledByDefault: true,
	createdAt: "2026-01-01T00:00:00.000Z",
	updatedAt: "2026-01-01T00:00:00.000Z",
	deletedAt: null,
	...freshChatSyncMeta(REV),
	...overrides,
});

const filled = (patch: Partial<ToolDraft> = {}): ToolDraft => ({
	...emptyToolDraft(),
	name: "greet",
	description: "Greets someone",
	template: "Hello {{who}}",
	...patch,
});

describe("draft → definition", () => {
	it("a template draft saves as written", () => {
		const plan = planToolSave(
			filled({
				parameters: [{ ...emptyParameterDraft(), name: "who", required: true }],
			}),
			[],
			null,
		);
		expect(plan).toEqual({
			kind: "save",
			enabledByDefault: true,
			tool: {
				declaration: {
					name: "greet",
					description: "Greets someone",
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
				action: { kind: "template", template: "Hello {{who}}" },
			},
		});
	});

	/** Choices constrain text only; a list kept on a number would be invisible state. */
	it("choices are kept for text parameters only, one per line", () => {
		const definition = toolDefinitionOf(
			filled({
				parameters: [
					{
						...emptyParameterDraft(),
						name: "mood",
						choices: "calm\n\nangry\n",
					},
					{
						...emptyParameterDraft(),
						name: "count",
						type: "number",
						choices: "1\n2",
					},
				],
			}),
		) as ChatCustomToolDto;
		expect(definition.declaration.parameters.map((p) => p.choices)).toEqual([
			["calm", "angry"],
			[],
		]);
	});

	it("table lines and draws parse; a non-number is refused, not defaulted", () => {
		const table = filled({ kind: "table", entries: "a\nb\n\n c", draws: "2" });
		expect((toolDefinitionOf(table) as ChatCustomToolDto).action).toEqual({
			kind: "table",
			entries: ["a", "b", " c"],
			draws: 2,
		});

		const broken = planToolSave({ ...table, draws: "two" }, [], null);
		expect(broken.kind).toBe("invalid");
		if (broken.kind === "invalid")
			expect(broken.issues.map((issue) => issue.field)).toContain("action");
	});

	it("an empty header row is dropped, a named one is kept", () => {
		const draft = filled({
			kind: "http",
			url: "https://example.test/hook",
			headers: [
				emptyHeaderDraft(),
				{ ...emptyHeaderDraft(), name: "Authorization", value: "Bearer k" },
			],
		});
		expect((toolDefinitionOf(draft) as ChatCustomToolDto).action).toEqual({
			kind: "http",
			url: "https://example.test/hook",
			method: "POST",
			headers: [{ name: "Authorization", value: "Bearer k" }],
		});
	});

	it("every kind round-trips through the draft", () => {
		const tools: ChatCustomToolDto[] = [
			{
				declaration: { name: "a", description: "d", parameters: [] },
				action: { kind: "template", template: "t" },
			},
			{
				declaration: { name: "b", description: "d", parameters: [] },
				action: { kind: "table", entries: ["x", "y"], draws: 3 },
			},
			{
				declaration: { name: "c", description: "d", parameters: [] },
				action: {
					kind: "agent",
					system: "You summarize.",
					maxOutputTokens: 512,
				},
			},
			{
				declaration: { name: "e", description: "d", parameters: [] },
				action: {
					kind: "http",
					url: "https://example.test",
					method: "GET",
					headers: [{ name: "X-Key", value: "v" }],
				},
			},
		];
		for (const tool of tools)
			expect(toolDefinitionOf(toolDraftOf(record(tool)))).toEqual(tool);
	});
});

describe("save plan", () => {
	it("an unchanged edit writes nothing", () => {
		const existing = record({
			declaration: { name: "greet", description: "Greets", parameters: [] },
			action: { kind: "template", template: "Hi" },
		});
		expect(planToolSave(toolDraftOf(existing), [existing], existing)).toEqual({
			kind: "unchanged",
		});
		expect(
			planToolSave(
				{ ...toolDraftOf(existing), enabledByDefault: false },
				[existing],
				existing,
			).kind,
		).toBe("save");
	});

	it("a name another live tool uses is refused on the name field; the edited tool itself is not", () => {
		const other = record(
			{
				declaration: { name: "greet", description: "x", parameters: [] },
				action: { kind: "template", template: "x" },
			},
			{ id: "other" },
		);
		const plan = planToolSave(filled(), [other], null);
		expect(plan.kind).toBe("invalid");
		if (plan.kind === "invalid")
			expect(plan.issues[0]).toEqual({
				field: "name",
				message: "Another tool already uses this name.",
			});

		/* Editing that same tool under its own name is not a collision. */
		expect(
			planToolSave(
				{ ...toolDraftOf(other), description: "changed" },
				[other],
				other,
			).kind,
		).toBe("save");
	});

	it("the reserved lore name is refused like the store refuses it", () => {
		const plan = planToolSave(filled({ name: "lore_search" }), [], null);
		expect(plan.kind).toBe("invalid");
		if (plan.kind === "invalid")
			expect(plan.issues.map((issue) => issue.field)).toEqual(["name"]);
	});
});

describe("issue mapping", () => {
	it("paths become the form's parts and labels", () => {
		expect(toolFormIssueOf("declaration.name: Bad name")).toEqual({
			field: "name",
			message: "Name: Bad name",
		});
		expect(toolFormIssueOf("declaration.parameters.1.name: Bad")).toEqual({
			field: "parameters",
			message: "Parameter 2 name: Bad",
		});
		expect(toolFormIssueOf("action.headers.0.name: Bad")).toEqual({
			field: "action",
			message: "Header 1 name: Bad",
		});
		expect(toolFormIssueOf("action.url: Bad").field).toBe("action");
		expect(toolFormIssueOf("No path here")).toEqual({
			field: "action",
			message: "No path here",
		});
	});
});

describe("tool file sentences", () => {
	it("each failure has its own sentence; a newer file is not called broken", () => {
		const sentences = (
			["not_tool_file", "newer_version", "too_large", "invalid"] as const
		).map(toolFileFailureMessage);
		expect(new Set(sentences).size).toBe(4);
		expect(toolFileFailureMessage("newer_version")).toMatch(/newer version/);
	});

	it("stripped headers are named, and no notice when none were", () => {
		expect(strippedHeadersNotice([])).toBeNull();
		expect(
			strippedHeadersNotice([{ tool: "lookup", header: "Authorization" }]),
		).toContain("lookup · Authorization");
	});

	it("an http entry says where it sends and what to fill in", () => {
		const item: ChatToolImportItem = {
			status: "new",
			existingId: null,
			entry: {
				index: 0,
				ok: true,
				tool: {
					declaration: { name: "lookup", description: "d", parameters: [] },
					action: {
						kind: "http",
						url: "https://api.example.test/x",
						method: "POST",
						headers: [{ name: "Authorization", value: "" }],
					},
				},
				http: {
					url: "https://api.example.test/x",
					origin: "https://api.example.test",
					headersToFill: ["Authorization"],
				},
			},
		};
		expect(importReachLines(item)).toEqual([
			"Sends to https://api.example.test",
			"Fill in after importing: Authorization",
		]);
		expect(importStatusLine(item)).toBe("New");
	});

	it("an invalid entry without a name is named by its position", () => {
		const item: ChatToolImportItem = {
			status: "invalid",
			existingId: null,
			entry: { index: 2, ok: false, name: null, issues: ["x"] },
		};
		expect(importItemName(item)).toBe("Unnamed tool · Entry 3");
		expect(importReachLines(item)).toEqual([]);
	});
});
