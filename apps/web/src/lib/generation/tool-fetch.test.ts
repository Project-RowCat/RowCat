import type { ChatStreamEvent } from "@rowcat/contracts/chat";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runToolAgent } from "./tool-agent.ts";
import { createToolFetch, type ToolFetchImpl } from "./tool-fetch.ts";
import type { GenerationTransport } from "./transport.ts";

/**
 * The two browser ports custom tools run through. What the types cannot show: a hung endpoint is
 * cut by the clock, the turn's stop reaches the request, the request never carries this site's
 * cookies or the page address, and a sub-agent's failure frame becomes a throw the loop can turn
 * into its fixed sentence.
 */

afterEach(() => {
	vi.useRealTimers();
});

/**
 * A fake endpoint that never answers until its signal aborts. Like the real `fetch`, an
 * already-aborted signal rejects at once.
 */
const hanging: ToolFetchImpl = (_url, init) =>
	new Promise((_resolve, reject) => {
		if (init.signal?.aborted) {
			reject(init.signal.reason);
			return;
		}
		init.signal?.addEventListener("abort", () =>
			reject(init.signal?.reason ?? new Error("aborted")),
		);
	});

describe("createToolFetch", () => {
	it("passes the call through without cookies or referrer", async () => {
		const impl = vi.fn<ToolFetchImpl>(async () => ({
			ok: true,
			status: 200,
			text: async () => "sunny",
		}));
		const fetch = createToolFetch(impl);

		const response = await fetch("https://example.test/weather", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: '{"tool":"weather"}',
			signal: new AbortController().signal,
		});

		expect(await response.text()).toBe("sunny");
		expect(response).toMatchObject({ ok: true, status: 200 });
		const init = impl.mock.calls[0]?.[1];
		expect(init).toMatchObject({
			method: "POST",
			headers: { "content-type": "application/json" },
			body: '{"tool":"weather"}',
			credentials: "omit",
			referrerPolicy: "no-referrer",
		});
	});

	it("a GET carries no body key", async () => {
		const impl = vi.fn<ToolFetchImpl>(async () => ({
			ok: true,
			status: 200,
			text: async () => "",
		}));
		await createToolFetch(impl)("https://example.test/?q=1", {
			method: "GET",
			headers: {},
			signal: new AbortController().signal,
		});
		expect(impl.mock.calls[0]?.[1]).not.toHaveProperty("body");
	});

	it("an endpoint that never answers is cut by the timeout", async () => {
		vi.useFakeTimers();
		const pending = createToolFetch(hanging, 1_000)("https://example.test", {
			method: "GET",
			headers: {},
			signal: new AbortController().signal,
		});
		const settled = expect(pending).rejects.toMatchObject({
			name: "TimeoutError",
		});
		await vi.advanceTimersByTimeAsync(1_000);
		await settled;
	});

	it("the turn's stop reaches the request, already-aborted included", async () => {
		const live = new AbortController();
		const pending = createToolFetch(hanging)("https://example.test", {
			method: "GET",
			headers: {},
			signal: live.signal,
		});
		live.abort(new Error("stopped"));
		await expect(pending).rejects.toThrow("stopped");

		const done = new AbortController();
		done.abort(new Error("already"));
		await expect(
			createToolFetch(hanging)("https://example.test", {
				method: "GET",
				headers: {},
				signal: done.signal,
			}),
		).rejects.toThrow("already");
	});

	it("a non-ok status is returned, not thrown: the tool layer decides", async () => {
		const response = await createToolFetch(async () => ({
			ok: false,
			status: 503,
			text: async () => "down",
		}))("https://example.test", {
			method: "GET",
			headers: {},
			signal: new AbortController().signal,
		});
		expect(response).toMatchObject({ ok: false, status: 503 });
	});
});

const transportOf = (events: ChatStreamEvent[]): GenerationTransport => ({
	stream: async function* () {
		yield* events;
	},
});

describe("runToolAgent", () => {
	const request = {
		system: "s",
		messages: [{ role: "user" as const, content: "p" }],
		maxOutputTokens: 10,
		reasoningEffort: null,
		continuation: false,
		tools: [],
	} as unknown as Parameters<typeof runToolAgent>[1];

	it("returns the concatenated text", async () => {
		const text = await runToolAgent(
			transportOf([
				{ type: "delta", text: "Too " },
				{ type: "delta", text: "long." },
			] as ChatStreamEvent[]),
			request,
			new AbortController().signal,
		);
		expect(text).toBe("Too long.");
	});

	it("an error frame is thrown", async () => {
		await expect(
			runToolAgent(
				transportOf([
					{ type: "delta", text: "partial" },
					{ type: "error", code: "rate_limited", message: "slow down" },
				] as ChatStreamEvent[]),
				request,
				new AbortController().signal,
			),
		).rejects.toThrow("rate_limited");
	});
});
