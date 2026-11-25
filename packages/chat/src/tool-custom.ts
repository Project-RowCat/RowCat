import type {
	ChatCustomToolAction,
	ChatCustomToolDto,
	ChatGenerationRequest,
	ChatToolArgumentValue,
	ChatToolHttpHeader,
} from "@rowcat/contracts/chat";
import type { ChatTool, ChatToolHandler } from "./tool.ts";

/**
 * Custom tools: turns a written definition (`ChatCustomToolDto`, from a user's settings or a
 * creator's work) into a `ChatTool` the loop can run.
 *
 * The four action kinds and what each needs from outside:
 * - template: nothing. The call's arguments fill `{{name}}` placeholders.
 * - table: randomness (`ports.random`).
 * - http: the network (`ports.fetch`). The app's port owns timeouts, because a timeout is a clock
 *   and this package does not hold one.
 * - agent: a second generation on the conversation's own connection (`ports.runAgent`). That is a
 *   sub-agent: it has its own system prompt, sees only what the model passed it, declares no tools
 *   (`chatAgentRequest`), and returns its text as the tool result.
 *
 * A kind whose port is missing is not registered (`chatCustomTool` returns `null`). Declaring a
 * tool that cannot run would make the model call it and receive an error every time, and the
 * declaration costs input tokens every turn either way. The server's protected-room loop passes no
 * `fetch`, so an `http` tool never runs there (creators cannot write one anyway).
 *
 * Not here: storage, transport, clocks, retries. Like the lore tool, this file only answers "what
 * does this call return".
 */

/** The subset of `fetch` the http action uses. The global `fetch` satisfies it structurally. */
export type ChatToolFetch = (
	url: string,
	init: {
		method: string;
		headers: Record<string, string>;
		body?: string;
		signal: AbortSignal;
	},
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

/** What a sub-agent run is given. The app turns it into a request (`chatAgentRequest`). */
export interface ChatAgentRun {
	/** The tool's name, for diagnostics only. It is not sent upstream. */
	name: string;
	system: string;
	/** The user message: the arguments the model passed, as lines (`chatAgentPrompt`). */
	prompt: string;
	maxOutputTokens: number;
}

export interface ChatCustomToolPorts {
	/** A number in [0, 1). The table action draws with it. */
	random(): number;
	/** Absent: `http` tools are not registered. */
	fetch?: ChatToolFetch;
	/** Absent: `agent` tools are not registered. Returns the agent's full text. */
	runAgent?: (run: ChatAgentRun, signal: AbortSignal) => Promise<string>;
}

const valueText = (value: ChatToolArgumentValue | undefined): string =>
	value === undefined ? "" : String(value);

/**
 * Replaces `{{name}}` (spaces allowed inside the braces) with the argument's text. A placeholder
 * that names no argument becomes empty: the resolver already folds `null` to absence, and leaving
 * the literal `{{name}}` in the result would show the model template syntax it cannot act on.
 */
export function fillChatToolTemplate(
	template: string,
	args: Readonly<Record<string, ChatToolArgumentValue>>,
): string {
	return template.replace(/\{\{\s*([a-z][a-z0-9_]*)\s*\}\}/g, (_match, key) =>
		valueText(args[key]),
	);
}

/**
 * Draws rows with replacement. Drawing without replacement would make `draws` larger than the table
 * a validation error the author can only discover by calling the tool.
 */
export function drawChatToolTable(
	entries: readonly string[],
	draws: number,
	random: () => number,
): string {
	const picked: string[] = [];
	for (let index = 0; index < draws; index += 1) {
		const at = Math.min(
			entries.length - 1,
			Math.max(0, Math.floor(random() * entries.length)),
		);
		const entry = entries[at];
		if (entry !== undefined) picked.push(entry);
	}
	return picked.join("\n");
}

/**
 * The agent's user message. Arguments go as `name: value` lines, in declaration order, so the same
 * call produces the same prompt on every device. With no arguments the agent is told it was called
 * as is, because an empty user message is rejected by every provider.
 */
export function chatAgentPrompt(
	parameters: readonly { name: string }[],
	args: Readonly<Record<string, ChatToolArgumentValue>>,
): string {
	const lines = parameters
		.filter((parameter) => args[parameter.name] !== undefined)
		.map(
			(parameter) => `${parameter.name}: ${valueText(args[parameter.name])}`,
		);
	return lines.length > 0
		? `다음 인자로 호출되었습니다.\n${lines.join("\n")}`
		: "인자 없이 호출되었습니다.";
}

/**
 * The sub-agent's request. It inherits only the parent turn's rating context, so an agent never runs
 * at a looser rating than the conversation that started it. Everything else is the agent's own:
 * - `tools: []`. That is what makes agents one level deep.
 * - No history. The agent sees what the model chose to pass, nothing of the conversation.
 * - No reasoning and no routing key. The agent's prefix is unrelated to the conversation's, so
 *   sharing its sticky route would only move the conversation's warm cache.
 */
export function chatAgentRequest(
	run: ChatAgentRun,
	parent: Pick<ChatGenerationRequest, "context">,
): ChatGenerationRequest {
	return {
		system: run.system,
		messages: [{ role: "user", content: run.prompt }],
		maxOutputTokens: run.maxOutputTokens,
		reasoningEffort: null,
		context: parent.context,
		continuation: false,
		tools: [],
	};
}

const headerRecord = (
	headers: readonly ChatToolHttpHeader[],
	json: boolean,
): Record<string, string> => {
	const record: Record<string, string> = json
		? { "content-type": "application/json" }
		: {};
	for (const header of headers) record[header.name] = header.value;
	return record;
};

/**
 * The URL for a GET call: arguments are appended as query parameters, after any the author wrote.
 */
export function chatHttpToolUrl(
	url: string,
	args: Readonly<Record<string, ChatToolArgumentValue>>,
): string {
	const query = Object.entries(args)
		.map(
			([key, value]) =>
				`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
		)
		.join("&");
	if (!query) return url;
	return `${url}${url.includes("?") ? "&" : "?"}${query}`;
}

function handlerOf(
	name: string,
	parameters: readonly { name: string }[],
	action: ChatCustomToolAction,
	ports: ChatCustomToolPorts,
): ChatToolHandler | null {
	switch (action.kind) {
		case "template":
			return async (args) => fillChatToolTemplate(action.template, args);
		case "table":
			return async () =>
				drawChatToolTable(action.entries, action.draws, ports.random);
		case "http": {
			const fetch = ports.fetch;
			if (!fetch) return null;
			return async (args, signal) => {
				const response =
					action.method === "GET"
						? await fetch(chatHttpToolUrl(action.url, args), {
								method: "GET",
								headers: headerRecord(action.headers, false),
								signal,
							})
						: await fetch(action.url, {
								method: "POST",
								headers: headerRecord(action.headers, true),
								body: JSON.stringify({ tool: name, arguments: args }),
								signal,
							});
				/**
				 * Thrown, not returned: the loop turns a throw into a fixed sentence (`chatToolErrorText`)
				 * and never reads the thrown value. An error body could carry anything the endpoint chose
				 * to print, and it would become model input.
				 */
				if (!response.ok) throw new Error(`http ${response.status}`);
				return response.text();
			};
		}
		case "agent": {
			const runAgent = ports.runAgent;
			if (!runAgent) return null;
			return (args, signal) =>
				runAgent(
					{
						name,
						system: action.system,
						prompt: chatAgentPrompt(parameters, args),
						maxOutputTokens: action.maxOutputTokens,
					},
					signal,
				);
		}
	}
}

/** One custom tool, or `null` when its kind needs a port this caller did not pass. */
export function chatCustomTool(
	tool: ChatCustomToolDto,
	ports: ChatCustomToolPorts,
): ChatTool | null {
	const run = handlerOf(
		tool.declaration.name,
		tool.declaration.parameters,
		tool.action,
		ports,
	);
	return run ? { declaration: tool.declaration, run } : null;
}
