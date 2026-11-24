import { afterEach, describe, expect, it, vi } from "vitest";
import { type ChatToolBaseFetch, createChatToolFetch } from "./tool-fetch.ts";

/**
 * The `http` tool port: one deadline over headers and body, no cookies, no error bodies. A fake
 * base `fetch` stands in for the network; the deadline runs on fake timers.
 */

afterEach(() => {
	vi.useRealTimers();
});

const init = (signal = new AbortController().signal) => ({
	method: "POST",
	headers: { "content-type": "application/json" },
	body: "{}",
	signal,
});

describe("the tool fetch port", () => {
	it("returns the body text and sends no cookies", async () => {
		const calls: Parameters<ChatToolBaseFetch>[] = [];
		const port = createChatToolFetch(async (...args) => {
			calls.push(args);
			return { ok: true, status: 200, text: async () => "result" };
		});
		const response = await port("https://example.test/tool", init());
		expect(response.ok).toBe(true);
		expect(await response.text()).toBe("result");
		expect(calls[0]?.[1].credentials).toBe("omit");
		expect(calls[0]?.[1].body).toBe("{}");
	});

	/** An error page could carry anything the endpoint printed; it must never become model input. */
	it("never reads an error body", async () => {
		const text = vi.fn(async () => "secret stack trace");
		const port = createChatToolFetch(async () => ({
			ok: false,
			status: 500,
			text,
		}));
		const response = await port("https://example.test/tool", init());
		expect(response.status).toBe(500);
		expect(await response.text()).toBe("");
		expect(text).not.toHaveBeenCalled();
	});

	it("aborts a call that outlives the deadline", async () => {
		vi.useFakeTimers();
		const port = createChatToolFetch(
			(_url, { signal }) =>
				new Promise((_resolve, reject) => {
					signal.addEventListener("abort", () => reject(new Error("aborted")));
				}),
			1_000,
		);
		const pending = port("https://example.test/tool", init());
		const settled = expect(pending).rejects.toThrow("aborted");
		await vi.advanceTimersByTimeAsync(1_000);
		await settled;
	});

	/** A server that sends headers and then stalls the body is cut too: the body is read inside. */
	it("the deadline covers the body", async () => {
		vi.useFakeTimers();
		const port = createChatToolFetch(
			async (_url, { signal }) => ({
				ok: true,
				status: 200,
				text: () =>
					new Promise<string>((_resolve, reject) => {
						signal.addEventListener("abort", () =>
							reject(new Error("aborted")),
						);
					}),
			}),
			1_000,
		);
		const pending = port("https://example.test/tool", init());
		const settled = expect(pending).rejects.toThrow("aborted");
		await vi.advanceTimersByTimeAsync(1_000);
		await settled;
	});

	it("passes the turn's own stop through", async () => {
		const stop = new AbortController();
		const port = createChatToolFetch(
			(_url, { signal }) =>
				new Promise((_resolve, reject) => {
					signal.addEventListener("abort", () => reject(new Error("stopped")));
				}),
		);
		const pending = port("https://example.test/tool", init(stop.signal));
		stop.abort();
		await expect(pending).rejects.toThrow("stopped");
	});
});
