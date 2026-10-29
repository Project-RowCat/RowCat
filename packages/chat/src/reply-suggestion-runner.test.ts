import type { ChatGenerationRequest } from "@rowcat/contracts/chat";
import { describe, expect, it } from "vitest";
import type { ReplySuggestionMessage } from "./reply-suggestion.ts";
import {
	type ReplySuggestionPort,
	runReplySuggestion,
} from "./reply-suggestion-runner.ts";

const HISTORY: ReplySuggestionMessage[] = [
	{ role: "user", speaker: "지훈", content: "왔어?" },
	{ role: "assistant", speaker: "", content: "비가 그쳤다." },
];

const RESPONSE = '{"suggestions":["가","나","다"]}';

interface Harness {
	port: ReplySuggestionPort;
	/**
	 * Counted outside the override, so calls that throw still increment the count. That makes it
	 * observable whether a request went out at all.
	 */
	requests: () => number;
	seen: () => ChatGenerationRequest | null;
}

function harness(overrides: Partial<ReplySuggestionPort> = {}): Harness {
	let requests = 0;
	let seen: ChatGenerationRequest | null = null;
	const base: ReplySuggestionPort = {
		loadMessages: async () => HISTORY,
		requestSuggestions: async () => RESPONSE,
		isValid: () => true,
	};
	const merged = { ...base, ...overrides };
	return {
		port: {
			...merged,
			requestSuggestions: (request, signal) => {
				requests += 1;
				seen = request;
				return merged.requestSuggestions(request, signal);
			},
		},
		requests: () => requests,
		seen: () => seen,
	};
}

const run = (h: Harness, opening: string | null = null) =>
	runReplySuggestion(h.port, { persona: null, opening, allAges: true });

describe("runReplySuggestion", () => {
	it("returns the sentences", async () => {
		const h = harness();
		await expect(run(h)).resolves.toEqual({
			status: "ready",
			suggestions: ["가", "나", "다"],
		});
	});

	it("checks ownership before starting: no paid call for a conversation that was left", async () => {
		const h = harness({ isValid: () => false });
		await expect(run(h)).resolves.toEqual({
			status: "failed",
			reason: "stale",
			error: null,
		});
		expect(h.requests()).toBe(0);
	});

	it("makes no request without a conversation to read", async () => {
		const h = harness({ loadMessages: async () => [] });
		await expect(run(h)).resolves.toEqual({
			status: "failed",
			reason: "unavailable",
			error: null,
		});
		expect(h.requests()).toBe(0);
	});

	it("a room where nothing was exchanged stands on its opening", async () => {
		const h = harness({ loadMessages: async () => [] });
		await expect(run(h, "문이 열려 있다.")).resolves.toMatchObject({
			status: "ready",
		});
		expect(h.seen()?.messages[0]?.content).toContain("문이 열려 있다.");
	});

	/**
	 * This is the material the app's failure table names. Keeping the reason split here would make
	 * that table exist twice.
	 *
	 * The fixture is deliberately a meaningless sentence. Balance or pricing vocabulary would make
	 * this package appear to know billing, and a static test locks that fact
	 * (`pricing-boundaries.test.ts` in `apps/web`).
	 */
	it("when the request fails it **carries the original error as is**", async () => {
		const error = new Error("upstream refused");
		const h = harness({
			requestSuggestions: async () => {
				throw error;
			},
		});
		await expect(run(h)).resolves.toEqual({
			status: "failed",
			reason: "request",
			error,
		});
	});

	it("stands nothing for a malformed response", async () => {
		const h = harness({
			requestSuggestions: async () => "미안하지만 못 하겠어요",
		});
		await expect(run(h)).resolves.toEqual({
			status: "failed",
			reason: "malformed",
			error: null,
		});
	});

	/**
	 * Does not rely on the abort signal. A request whose body has fully arrived ignores the signal and
	 * resolves as success, so the check reads state instead.
	 */
	it("stands nothing when the conversation changed by arrival", async () => {
		let valid = true;
		const h = harness({
			isValid: () => valid,
			requestSuggestions: async () => {
				valid = false;
				return RESPONSE;
			},
		});
		await expect(run(h)).resolves.toEqual({
			status: "failed",
			reason: "stale",
			error: null,
		});
	});

	it("**does not throw** when the store throws: the conversation screen does not break", async () => {
		const h = harness({
			loadMessages: async () => {
				throw new Error("store closed");
			},
		});
		await expect(run(h)).resolves.toMatchObject({
			status: "failed",
			reason: "request",
		});
	});

	it("commits nothing: the port has no such capability", () => {
		const h = harness();
		expect(h.port).not.toHaveProperty("commit");
	});
});
