/**
 * A local OpenAI-compatible server for the desktop window journey (`afterstate-window.e2e.ts`).
 *
 * It stands in for the BYO provider (`packages/chat/src/openai-compatible.ts` accepts plain `http`
 * only on this device's loopback), so no turn ever reaches a real provider and no real key exists.
 * Every request body is appended to a JSON-lines log, which is how the journey inspects the request
 * the web app assembled (the recall block is in the last user turn, `packages/chat/src/context.ts`).
 *
 * Replies are scripted by keyword in the last user turn, and stream as chat-completions SSE in a few
 * chunks so the window really renders a streaming answer. Requests that are not streams (V2
 * maintenance, suggestions) get a short non-streamed answer; the journey does not depend on them.
 */
import { appendFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

export interface MockCall {
	at: string;
	method: string;
	path: string;
	authorization: string | undefined;
	body: unknown;
	/** The streamed reply text, when this call was a streamed turn. */
	reply?: string;
}

export interface MockProvider {
	origin: string;
	calls: MockCall[];
	/** Chat-completion bodies whose `stream` is true: the turns the window generated. */
	turns(): ChatBody[];
	close(): Promise<void>;
}

export interface ChatBody {
	model?: string;
	stream?: boolean;
	messages?: { role: string; content: unknown }[];
}

export const MOCK_MODEL = "mock-local-1";

/** Keyword in the last user turn → the scripted reply (Korean included on purpose). */
const SCRIPT: [RegExp, string][] = [
	[/열쇠를 어디에 숨겼어/, "열쇠는 등대 옆 빨간 우체통 안에 숨겨 두었어."],
];

export function replyFor(lastUser: string, n: number): string {
	// What the person typed: a recalled block in front of it ("[발췌 끝]") quotes older turns.
	const typed = lastUser.split("[발췌 끝]").pop() ?? lastUser;
	for (const [pattern, reply] of SCRIPT)
		if (pattern.test(typed)) return reply;
	return `모의 응답 ${n}번입니다. (mock reply ${n})`;
}

export const lastUserText = (body: ChatBody): string => {
	const users = (body.messages ?? []).filter((m) => m.role === "user");
	const content = users[users.length - 1]?.content;
	if (typeof content === "string") return content;
	if (Array.isArray(content))
		return content
			.map((part) =>
				typeof part === "object" && part && "text" in part
					? String((part as { text: unknown }).text)
					: "",
			)
			.join("");
	return "";
};

const CORS = {
	"access-control-allow-origin": "*",
	"access-control-allow-headers": "authorization, content-type",
	"access-control-allow-methods": "GET, POST, OPTIONS",
};

export async function startMockProvider(logFile: string): Promise<MockProvider> {
	const calls: MockCall[] = [];
	let streamed = 0;
	const server: Server = createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on("data", (c: Buffer) => chunks.push(c));
		req.on("end", () => {
			if (req.method === "OPTIONS") {
				res.writeHead(204, CORS).end();
				return;
			}
			const raw = Buffer.concat(chunks).toString("utf8");
			let body: unknown = null;
			try {
				body = raw ? JSON.parse(raw) : null;
			} catch {
				body = raw;
			}
			const call: MockCall = {
				at: new Date().toISOString(),
				method: req.method ?? "",
				path: req.url ?? "",
				authorization: req.headers.authorization,
				body,
			};
			const chatBody = (body ?? {}) as ChatBody;
			if (req.url === "/v1/chat/completions" && chatBody.stream === true) {
				streamed += 1;
				call.reply = replyFor(lastUserText(chatBody), streamed);
			}
			calls.push(call);
			appendFileSync(logFile, `${JSON.stringify(call)}\n`);

			if (req.method === "GET" && req.url === "/v1/models") {
				res
					.writeHead(200, { ...CORS, "content-type": "application/json" })
					.end(JSON.stringify({ object: "list", data: [{ id: MOCK_MODEL, object: "model" }] }));
				return;
			}
			if (req.method === "POST" && req.url === "/v1/chat/completions") {
				const chat = (body ?? {}) as ChatBody;
				if (chat.stream !== true) {
					res
						.writeHead(200, { ...CORS, "content-type": "application/json" })
						.end(
							JSON.stringify({
								id: "mock",
								object: "chat.completion",
								model: MOCK_MODEL,
								choices: [
									{ index: 0, message: { role: "assistant", content: "{}" }, finish_reason: "stop" },
								],
								usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
							}),
						);
					return;
				}
				const text = call.reply ?? "";
				res.writeHead(200, {
					...CORS,
					"content-type": "text/event-stream",
					"cache-control": "no-cache",
				});
				const parts = text.match(/.{1,6}/gsu) ?? [text];
				const frame = (delta: object, finish: string | null) =>
					`data: ${JSON.stringify({
						id: `mock-${streamed}`,
						object: "chat.completion.chunk",
						model: MOCK_MODEL,
						choices: [{ index: 0, delta, finish_reason: finish }],
					})}\n\n`;
				let i = 0;
				res.write(frame({ role: "assistant", content: "" }, null));
				const tick = setInterval(() => {
					if (i < parts.length) {
						res.write(frame({ content: parts[i] }, null));
						i += 1;
						return;
					}
					clearInterval(tick);
					res.write(frame({}, "stop"));
					res.write(
						`data: ${JSON.stringify({
							id: `mock-${streamed}`,
							object: "chat.completion.chunk",
							model: MOCK_MODEL,
							choices: [],
							usage: { prompt_tokens: 10, completion_tokens: parts.length, total_tokens: 10 + parts.length },
						})}\n\n`,
					);
					res.end("data: [DONE]\n\n");
				}, 15);
				return;
			}
			res.writeHead(404, CORS).end();
		});
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address() as AddressInfo;
	return {
		origin: `http://127.0.0.1:${port}`,
		calls,
		turns: () =>
			calls
				.filter((c) => c.path === "/v1/chat/completions" && (c.body as ChatBody)?.stream === true)
				.map((c) => c.body as ChatBody),
		close: () =>
			new Promise<void>((resolve) => {
				server.closeAllConnections();
				server.close(() => resolve());
			}),
	};
}
