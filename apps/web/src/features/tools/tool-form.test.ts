import type { ChatUserTool } from "@rowcat/chat";
import { CHAT_CUSTOM_TOOL_LIMITS } from "@rowcat/contracts/chat";
import { describe, expect, it } from "vitest";
import {
	checkToolDraft,
	emptyHeaderDraft,
	emptyParameterDraft,
	emptyToolDraft,
	issuesFor,
	type ToolFormDraft,
	toolDraftOf,
	toolFormIssueOf,
	toolOrigin,
} from "./tool-form.ts";

/**
 * The editor's translation layer. The rules belong to the contract; what is checked here is that
 * typing becomes the definition the contract expects, that every issue lands on the field that
 * caused it in the render's words, and that a stored tool round-trips through the form unchanged.
 */

const draft = (patch: Partial<ToolFormDraft>): ToolFormDraft => ({
	...emptyToolDraft(),
	name: "roll_dice",
	description: "Rolls dice.",
	template: "You rolled {{sides}}.",
	...patch,
});

const stored = (tool: ChatUserTool["tool"], id = "tool-1"): ChatUserTool =>
	({
		id,
		tool,
		enabledByDefault: false,
		createdAt: "2026-01-01T00:00:00.000Z",
		updatedAt: "2026-01-01T00:00:00.000Z",
		deletedAt: null,
		rev: { t: 0, c: 0, d: "test" },
		dirty: 0,
	}) as ChatUserTool;

describe("checkToolDraft", () => {
	it("a filled template becomes its definition, names trimmed and prose kept", () => {
		const checked = checkToolDraft(
			draft({
				name: " roll_dice ",
				parameters: [
					{
						...emptyParameterDraft(),
						name: "sides",
						type: "string",
						choices: "d6\n\n d20 \n",
						required: true,
					},
				],
			}),
			[],
		);
		expect(checked).toEqual({
			ok: true,
			tool: {
				declaration: {
					name: "roll_dice",
					description: "Rolls dice.",
					parameters: [
						{
							name: "sides",
							type: "string",
							description: "",
							required: true,
							choices: ["d6", "d20"],
						},
					],
				},
				action: { kind: "template", template: "You rolled {{sides}}." },
			},
		});
	});

	it("choices are saved only for text parameters", () => {
		const checked = checkToolDraft(
			draft({
				parameters: [
					{
						...emptyParameterDraft(),
						name: "n",
						type: "number",
						choices: "1\n2",
					},
				],
			}),
			[],
		);
		expect(
			checked.ok && checked.tool.declaration.parameters[0]?.choices,
		).toEqual([]);
	});

	it("each kind saves only its own fields; the others are kept in the form", () => {
		const base = draft({
			template: "kept",
			entries: "a\nb",
			draws: "2",
			system: "Be brief.",
			maxOutputTokens: "300",
			url: " https://example.test/x ",
			method: "GET",
			headers: [{ ...emptyHeaderDraft(), name: "X-Key", value: "v" }],
		});
		const action = (kind: ToolFormDraft["kind"]) => {
			const checked = checkToolDraft({ ...base, kind }, []);
			return checked.ok ? checked.tool.action : checked.issues;
		};
		expect(action("table")).toEqual({
			kind: "table",
			entries: ["a", "b"],
			draws: 2,
		});
		expect(action("agent")).toEqual({
			kind: "agent",
			system: "Be brief.",
			maxOutputTokens: 300,
		});
		expect(action("http")).toEqual({
			kind: "http",
			url: "https://example.test/x",
			method: "GET",
			headers: [{ name: "X-Key", value: "v" }],
		});
	});

	it("issues land on their fields", () => {
		const checked = checkToolDraft(
			draft({
				name: "Bad Name",
				description: "",
				kind: "table",
				entries: "",
				draws: "",
			}),
			[],
		);
		expect(checked.ok).toBe(false);
		if (checked.ok) return;
		expect(issuesFor(checked.issues, "name")).toHaveLength(1);
		expect(issuesFor(checked.issues, "description")).toHaveLength(1);
		expect(issuesFor(checked.issues, "entries")).toHaveLength(1);
		expect(issuesFor(checked.issues, "draws")).toHaveLength(1);
		expect(issuesFor(checked.issues, "form")).toEqual([]);
	});

	it("parameter and header issues land on their rows", () => {
		const checked = checkToolDraft(
			draft({
				kind: "http",
				url: "ftp://nope",
				parameters: [
					{ ...emptyParameterDraft(), name: "ok" },
					{ ...emptyParameterDraft(), name: "Not OK" },
				],
				headers: [{ ...emptyHeaderDraft(), name: "bad header", value: "" }],
			}),
			[],
		);
		expect(checked.ok).toBe(false);
		if (checked.ok) return;
		expect(issuesFor(checked.issues, "parameter:0")).toEqual([]);
		expect(issuesFor(checked.issues, "parameter:1")).toHaveLength(1);
		expect(issuesFor(checked.issues, "header:0")).toHaveLength(1);
		expect(issuesFor(checked.issues, "url")).toHaveLength(1);
	});

	it("repeated parameter names are one sentence on the parameter list", () => {
		const checked = checkToolDraft(
			draft({
				parameters: [
					{ ...emptyParameterDraft(), name: "a" },
					{ ...emptyParameterDraft(), name: "a" },
				],
			}),
			[],
		);
		expect(!checked.ok && issuesFor(checked.issues, "parameters")).toEqual([
			"Parameter names can't repeat.",
		]);
	});

	it("a reserved name gets its own sentence, not the pattern advice", () => {
		const checked = checkToolDraft(draft({ name: "lore_search" }), []);
		expect(!checked.ok && issuesFor(checked.issues, "name")).toEqual([
			"This name is built in. Choose another.",
		]);
	});

	it("a name another live tool uses is refused; the tool's own name is not", () => {
		const existing = stored(
			{
				declaration: { name: "roll_dice", description: "d", parameters: [] },
				action: { kind: "template", template: "x" },
			},
			"existing",
		);
		const taken = checkToolDraft(draft({}), [existing]);
		expect(!taken.ok && issuesFor(taken.issues, "name")).toEqual([
			"Another tool already uses this name.",
		]);
		expect(checkToolDraft(draft({}), [existing], "existing").ok).toBe(true);
		expect(
			checkToolDraft(draft({}), [{ ...existing, deletedAt: "2026-01-02" }]).ok,
		).toBe(true);
	});

	it("one sentence per field even when many rows fail the same way", () => {
		const long = "x".repeat(CHAT_CUSTOM_TOOL_LIMITS.tableEntryChars + 1);
		const checked = checkToolDraft(
			draft({ kind: "table", entries: `${long}\n${long}\n${long}` }),
			[],
		);
		expect(!checked.ok && issuesFor(checked.issues, "entries")).toHaveLength(1);
	});
});

describe("toolDraftOf", () => {
	it("a stored tool round-trips through the form unchanged", () => {
		const tools: ChatUserTool["tool"][] = [
			{
				declaration: {
					name: "weather",
					description: "Weather.",
					parameters: [
						{
							name: "city",
							type: "string",
							description: "City.",
							required: true,
							choices: ["Seoul", "Busan"],
						},
					],
				},
				action: {
					kind: "http",
					url: "https://example.test/w",
					method: "POST",
					headers: [{ name: "Authorization", value: "Bearer k" }],
				},
			},
			{
				declaration: { name: "draw", description: "Draw.", parameters: [] },
				action: { kind: "table", entries: ["a", "b"], draws: 3 },
			},
			{
				declaration: { name: "critic", description: "Critic.", parameters: [] },
				action: { kind: "agent", system: "Be terse.", maxOutputTokens: 200 },
			},
		];
		for (const tool of tools) {
			const record = stored(tool);
			const form = toolDraftOf(record);
			expect(form.enabledByDefault).toBe(false);
			expect(checkToolDraft(form, [record], record.id)).toEqual({
				ok: true,
				tool,
			});
		}
	});
});

describe("toolFormIssueOf", () => {
	it("an unknown path keeps the raw text rather than dropping it", () => {
		expect(toolFormIssueOf("something: odd")).toEqual({
			field: "form",
			message: "Check this tool's settings: something: odd",
		});
	});
});

describe("toolOrigin", () => {
	it("is the scheme and host of an http tool, and null otherwise", () => {
		expect(
			toolOrigin({
				declaration: { name: "w", description: "d", parameters: [] },
				action: {
					kind: "http",
					url: "https://API.example.test:8443/v1/x?y=1",
					method: "GET",
					headers: [],
				},
			}),
		).toBe("https://api.example.test:8443");
		expect(
			toolOrigin({
				declaration: { name: "t", description: "d", parameters: [] },
				action: { kind: "template", template: "x" },
			}),
		).toBeNull();
	});
});
