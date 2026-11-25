import type {
	ChatCreatorToolDto,
	ChatCustomToolDto,
	ChatGenerationRequest,
	ChatSeedLoreDto,
} from "@rowcat/contracts/chat";
import { CHAT_MAX_TOOLS } from "@rowcat/contracts/chat";
import { describe, expect, it, vi } from "vitest";
import {
	type ChatAgentRun,
	type ChatCustomToolPorts,
	type ChatToolFetch,
	chatAgentPrompt,
	chatAgentRequest,
	chatCustomTool,
	chatHttpToolUrl,
	drawChatToolTable,
	fillChatToolTemplate,
} from "./tool-custom.ts";
import { CHAT_LORE_TOOL_NAME } from "./tool-lore.ts";
import { chatConversationTools } from "./tool-registry.ts";
import {
	authorToolOverrides,
	creatorConsentTools,
	creatorToolActiveIn,
	creatorToolOverrideKey,
} from "./user-tool.ts";

/**
 * What custom tools must guarantee:
 * - Each action kind returns exactly what its definition says, on every device (randomness and the
 *   network are ports, so tests pin them).
 * - A kind whose port is missing is not registered, so the model is never offered a tool that
 *   cannot run.
 * - A sub-agent is one level deep: its request declares no tools and inherits only the parent's
 *   safety context.
 * - The registry's order is precedence: lore, then the work's tools, then the user's, first name
 *   wins, capped at the contract's maximum.
 */

const ports = (
	over: Partial<ChatCustomToolPorts> = {},
): ChatCustomToolPorts => ({
	random: () => 0,
	...over,
});

const signal = new AbortController().signal;

const tool = (
	name: string,
	action: ChatCustomToolDto["action"],
	parameters: ChatCustomToolDto["declaration"]["parameters"] = [],
): ChatCustomToolDto => ({
	declaration: { name, description: `${name} 도구`, parameters },
	action,
});

const param = (name: string) => ({
	name,
	type: "string" as const,
	description: "",
	required: false,
	choices: [],
});

describe("template", () => {
	it("fills placeholders with arguments and empties unknown ones", () => {
		expect(
			fillChatToolTemplate("{{ who }}가 {{what}}을 했다{{missing}}.", {
				who: "미라",
				what: 3,
			}),
		).toBe("미라가 3을 했다.");
	});

	it("runs as a tool", async () => {
		const built = chatCustomTool(
			tool("greet", { kind: "template", template: "안녕, {{name}}" }, [
				param("name"),
			]),
			ports(),
		);
		expect(await built?.run({ name: "세나" }, signal)).toBe("안녕, 세나");
	});
});

describe("table", () => {
	it("draws with replacement through the random port", () => {
		const rolls = [0, 0.99, 0.5];
		let at = 0;
		const random = () => rolls[at++] ?? 0;
		expect(drawChatToolTable(["a", "b", "c"], 3, random)).toBe("a\nc\nb");
	});

	it("clamps a random value outside [0, 1)", () => {
		expect(drawChatToolTable(["a", "b"], 1, () => 1)).toBe("b");
		expect(drawChatToolTable(["a", "b"], 1, () => -1)).toBe("a");
	});
});

describe("http", () => {
	const httpTool = (method: "GET" | "POST") =>
		tool(
			"weather",
			{
				kind: "http",
				url: "https://example.com/hook?key=1",
				method,
				headers: [{ name: "Authorization", value: "Bearer x" }],
			},
			[param("city")],
		);

	it("is not registered without a fetch port", () => {
		expect(chatCustomTool(httpTool("POST"), ports())).toBeNull();
	});

	it("POSTs the tool name and arguments as JSON with the author's headers", async () => {
		const fetch = vi.fn<ChatToolFetch>(async () => ({
			ok: true,
			status: 200,
			text: async () => "맑음",
		}));
		const built = chatCustomTool(httpTool("POST"), ports({ fetch }));
		expect(await built?.run({ city: "서울" }, signal)).toBe("맑음");
		const [url, init] = fetch.mock.calls[0] ?? [];
		expect(url).toBe("https://example.com/hook?key=1");
		expect(init?.method).toBe("POST");
		expect(init?.headers).toEqual({
			"content-type": "application/json",
			Authorization: "Bearer x",
		});
		expect(JSON.parse(init?.body ?? "")).toEqual({
			tool: "weather",
			arguments: { city: "서울" },
		});
	});

	it("GETs with arguments appended to the author's query", async () => {
		const fetch = vi.fn<ChatToolFetch>(async () => ({
			ok: true,
			status: 200,
			text: async () => "ok",
		}));
		await chatCustomTool(httpTool("GET"), ports({ fetch }))?.run(
			{ city: "부 산" },
			signal,
		);
		expect(fetch.mock.calls[0]?.[0]).toBe(
			"https://example.com/hook?key=1&city=%EB%B6%80%20%EC%82%B0",
		);
		expect(fetch.mock.calls[0]?.[1].body).toBeUndefined();
	});

	it("throws on a non-2xx response so the loop answers with its fixed sentence", async () => {
		const fetch: ChatToolFetch = async () => ({
			ok: false,
			status: 500,
			text: async () => "stack trace with secrets",
		});
		await expect(
			chatCustomTool(httpTool("POST"), ports({ fetch }))?.run({}, signal),
		).rejects.toThrow("http 500");
	});

	it("builds a GET URL without a query when there are no arguments", () => {
		expect(chatHttpToolUrl("https://a.test/x", {})).toBe("https://a.test/x");
		expect(chatHttpToolUrl("https://a.test/x", { a: true })).toBe(
			"https://a.test/x?a=true",
		);
	});
});

describe("agent (sub-agent)", () => {
	const agentTool = tool(
		"advisor",
		{ kind: "agent", system: "너는 조언자다.", maxOutputTokens: 300 },
		[param("question"), param("mood")],
	);

	it("is not registered without a runAgent port", () => {
		expect(chatCustomTool(agentTool, ports())).toBeNull();
	});

	it("passes its own system prompt and the arguments as lines", async () => {
		const runs: ChatAgentRun[] = [];
		const built = chatCustomTool(
			agentTool,
			ports({
				runAgent: async (run) => {
					runs.push(run);
					return "조심하세요.";
				},
			}),
		);
		expect(await built?.run({ question: "갈까?" }, signal)).toBe("조심하세요.");
		expect(runs).toEqual([
			{
				name: "advisor",
				system: "너는 조언자다.",
				prompt: "다음 인자로 호출되었습니다.\nquestion: 갈까?",
				maxOutputTokens: 300,
			},
		]);
	});

	it("never sends an empty user message", () => {
		expect(chatAgentPrompt([param("a")], {})).toBe("인자 없이 호출되었습니다.");
	});

	it("declares no tools and inherits only the parent's rating context", () => {
		const parent = {
			context: { requestedMode: "adult" },
			routingSessionId: "route-1",
		} as unknown as ChatGenerationRequest;
		const request = chatAgentRequest(
			{ name: "advisor", system: "s", prompt: "p", maxOutputTokens: 10 },
			parent,
		);
		expect(request).toEqual({
			system: "s",
			messages: [{ role: "user", content: "p" }],
			maxOutputTokens: 10,
			reasoningEffort: null,
			context: { requestedMode: "adult" },
			continuation: false,
			tools: [],
		});
	});
});

describe("chatConversationTools", () => {
	const lore: ChatSeedLoreDto[] = [
		{
			keys: ["영주"],
			content: "영주는 없다.",
			constant: false,
			position: "system_bottom",
			order: 0,
		},
	];
	const template = (name: string): ChatCreatorToolDto => ({
		declaration: { name, description: `${name} 도구`, parameters: [] },
		action: { kind: "template", template: name },
	});
	const names = (tools: { declaration: { name: string } }[]) =>
		tools.map((entry) => entry.declaration.name);

	it("builds only lore search without ports, as before custom tools", () => {
		expect(
			names(
				chatConversationTools(
					{ seed: { lore, tools: [template("creator")] } },
					{ userTools: [template("mine")] },
				),
			),
		).toEqual([CHAT_LORE_TOOL_NAME]);
	});

	it("orders lore, the work's tools, then the user's, and the first name wins", () => {
		const tools = chatConversationTools(
			{
				seed: {
					lore,
					tools: [template("shared"), template(CHAT_LORE_TOOL_NAME)],
				},
			},
			{ ports: ports(), userTools: [template("shared"), template("mine")] },
		);
		expect(names(tools)).toEqual([CHAT_LORE_TOOL_NAME, "shared", "mine"]);
	});

	it("keeps the work's tool when a user tool has the same name", async () => {
		const tools = chatConversationTools(
			{
				seed: {
					lore: [],
					tools: [
						{
							...template("x"),
							action: { kind: "template", template: "work" },
						},
					],
				},
			},
			{
				ports: ports(),
				userTools: [tool("x", { kind: "template", template: "user" })],
			},
		);
		expect(await tools[0]?.run({}, signal)).toBe("work");
	});

	it("stops at the contract's cap", () => {
		const many = Array.from({ length: CHAT_MAX_TOOLS + 3 }, (_, index) =>
			template(`t${index}`),
		);
		expect(
			chatConversationTools(
				{ seed: { lore: [] } },
				{ ports: ports(), userTools: many },
			),
		).toHaveLength(CHAT_MAX_TOOLS);
	});

	it("treats a stored room without the tools key as a work without tools", () => {
		expect(
			chatConversationTools({ seed: { lore: [] } }, { ports: ports() }),
		).toEqual([]);
	});
});

/**
 * A work's `http` tool calls the reader's own machine with what the model wrote from their
 * conversation, so it is never declared unless the reader switched it on in that room.
 */
describe("the work's local http tools", () => {
	const hook = (url = "http://localhost:8787/hook"): ChatCreatorToolDto => ({
		declaration: {
			name: "hook",
			description: "Calls a local app.",
			parameters: [],
		},
		action: { kind: "http", url, method: "POST", headers: [] },
	});
	const fetchPort: ChatToolFetch = async () => ({
		ok: true,
		status: 200,
		text: async () => "ok",
	});
	const on = { [creatorToolOverrideKey("hook")]: true };

	it("is off without the reader's switch, and with no switches at all", () => {
		const room = { seed: { lore: [], tools: [hook()] } };
		expect(
			chatConversationTools(room, { ports: ports({ fetch: fetchPort }) }),
		).toEqual([]);
		expect(
			chatConversationTools(room, {
				ports: ports({ fetch: fetchPort }),
				toolOverrides: { [creatorToolOverrideKey("hook")]: false },
			}),
		).toEqual([]);
	});

	it("runs where the reader switched it on", async () => {
		const tools = chatConversationTools(
			{ seed: { lore: [], tools: [hook()] } },
			{ ports: ports({ fetch: fetchPort }), toolOverrides: on },
		);
		expect(tools.map((entry) => entry.declaration.name)).toEqual(["hook"]);
		expect(await tools[0]?.run({}, signal)).toBe("ok");
	});

	it("is not declared without a fetch port (the server's protected loop), switch or not", () => {
		expect(
			chatConversationTools(
				{ seed: { lore: [], tools: [hook()] } },
				{ ports: ports(), toolOverrides: on },
			),
		).toEqual([]);
	});

	it("never runs off loopback or with headers, even from a record that skipped the contract", () => {
		const offHost = hook("https://example.com/hook");
		const withHeader: ChatCreatorToolDto = {
			...hook(),
			action: {
				kind: "http",
				url: "http://localhost:8787/hook",
				method: "POST",
				headers: [{ name: "Authorization", value: "k" }],
			},
		};
		for (const tool of [offHost, withHeader]) {
			expect(creatorToolActiveIn({ toolOverrides: on }, tool)).toBe(false);
			expect(creatorConsentTools({ tools: [tool] })).toEqual([]);
		}
	});

	it("leaves every other creator kind on without a switch", () => {
		expect(
			creatorToolActiveIn(
				{},
				{
					declaration: { name: "t", description: "x", parameters: [] },
					action: { kind: "template", template: "x" },
				},
			),
		).toBe(true);
	});

	it("lists what room settings shows: name, description and the address without its path", () => {
		expect(
			creatorConsentTools({
				tools: [hook("http://127.0.0.1:11434/api/x?y=1")],
			}),
		).toEqual([
			{
				name: "hook",
				description: "Calls a local app.",
				address: "http://127.0.0.1:11434",
				key: "creator:hook",
			},
		]);
	});

	it("switches every one on for the author's own work test", () => {
		expect(authorToolOverrides({ tools: [hook()] })).toEqual(on);
		expect(authorToolOverrides({})).toEqual({});
	});
});
