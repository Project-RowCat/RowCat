import {
	CHAT_DEFAULT_OUTPUT_TOKENS,
	CHAT_ERROR_CODE,
	type ManagedGenerationBudgetDto,
} from "@rowcat/contracts";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, test, vi } from "vitest";
import { app } from "../app.ts";
import { closeDb, db } from "../db/client.ts";
import { member } from "../db/schema.ts";
import {
	__setRateLimitStoreForTest,
	createMemoryRateLimitStore,
} from "../lib/rate-limit/index.ts";
import { rateLimitKey } from "../lib/rate-limit/limiter.ts";
import { RATE_LIMIT_POLICIES } from "../lib/rate-limit/policy.ts";
import type { RateLimitStore } from "../lib/rate-limit/store.ts";
import { MANAGED_GENERATION_INSTANCE } from "../services/generation/budget.ts";
import { allowManagedGeneration, createTestMember } from "../test/auth.ts";
import { connectTestDatabase, deleteTestUsers } from "../test/database.ts";
import { WEB_ORIGIN } from "../test/http.ts";

/**
 * The instance-wide ceilings on the operator's key (`services/generation/budget.ts`): slots, the
 * token budget and the per-call ceiling, through the real routes. What each case pins is what a
 * deployment would otherwise find on the provider's invoice: a request that should have been refused
 * reaching upstream, a stream that ended without being charged, a slot that never came back.
 *
 * The provider is the only thing faked. Counters are read straight from the store the route used, by
 * the same keys the limiter builds, so a test cannot pass by asking the code under test what it did.
 */

const EMAIL_PREFIX = "chat-budget-test-";
const TOKENS = RATE_LIMIT_POLICIES.managedGenerationTokens;
const SLOTS = RATE_LIMIT_POLICIES.managedGenerationSlots;
const tokensKey = rateLimitKey(TOKENS.name, MANAGED_GENERATION_INSTANCE);
const slotsKey = rateLimitKey(SLOTS.name, MANAGED_GENERATION_INSTANCE);

const signUp = async () => {
	const created = await createTestMember(EMAIL_PREFIX, { name: "budget" });
	await allowManagedGeneration(created.memberId);
	return created;
};

const request = (extra: object = {}) => ({
	system: "You narrate.",
	messages: [{ role: "user", content: "Hi" }],
	context: { requestedMode: "all-ages" },
	model: "claude-sonnet-5",
	...extra,
});

const generate = (
	cookie: string,
	body: unknown = request(),
	signal?: AbortSignal,
) =>
	Promise.resolve(
		app.request("/v2/chat/generate", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Origin: WEB_ORIGIN,
				Cookie: cookie,
			},
			body: JSON.stringify(body),
			signal,
		}),
	);

const encoder = new TextEncoder();
const sse = (lines: string[]) =>
	encoder.encode(lines.map((line) => `data: ${line}\n\n`).join(""));
const DELTA = '{"choices":[{"delta":{"content":"Yes"},"finish_reason":null}]}';
const STOP = '{"choices":[{"delta":{},"finish_reason":"stop"}]}';
const USAGE =
	'{"choices":[],"usage":{"prompt_tokens":120,"completion_tokens":30}}';

/** A provider stream the test finishes by hand: `release()` sends the rest and closes. */
function heldProvider(tail: string[]) {
	const open: (() => void)[] = [];
	let calls = 0;
	vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
		calls += 1;
		let finish: () => void = () => {};
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(sse([DELTA]));
				/** Like a real socket: the route's abort (client gone, wall clock) ends the upstream read. */
				init?.signal?.addEventListener("abort", () => {
					try {
						controller.error(new DOMException("aborted", "AbortError"));
					} catch {
						/* already closed */
					}
				});
				finish = () => {
					try {
						controller.enqueue(sse([...tail, "[DONE]"]));
						controller.close();
					} catch {
						/* the reader already left */
					}
				};
				open.push(() => finish());
			},
		});
		return new Response(body, {
			status: 200,
			headers: { "content-type": "text/event-stream" },
		});
	});
	return {
		calls: () => calls,
		release: () => {
			for (const finish of open.splice(0)) finish();
		},
	};
}

function provider(lines: string[]) {
	return heldProvider(lines);
}

const usageOf = (text: string): number =>
	text
		.split("\n")
		.filter((line) => line.trim())
		.map((line) => JSON.parse(line) as Record<string, unknown>)
		.filter((event) => event.type === "usage")
		.reduce(
			(sum, event) =>
				sum + Number(event.inputTokens ?? 0) + Number(event.outputTokens ?? 0),
			0,
		);

const tick = () => new Promise((resolve) => setTimeout(resolve, 20));

const databaseReady = await connectTestDatabase();

afterEach(async () => {
	vi.restoreAllMocks();
	await __setRateLimitStoreForTest(null);
});

afterAll(async () => {
	if (databaseReady) await deleteTestUsers(EMAIL_PREFIX);
	await closeDb();
});

describe.skipIf(!databaseReady)("instance ceilings — charging", () => {
	test("a finished stream is charged what the provider reported, and its slot comes back", async () => {
		const store = createMemoryRateLimitStore();
		await __setRateLimitStoreForTest(store);
		const { cookie } = await signUp();
		const upstream = provider([STOP, USAGE]);

		const response = await generate(cookie);
		expect(response.status).toBe(200);
		upstream.release();
		const reported = usageOf(await response.text());

		expect(reported).toBeGreaterThan(0);
		expect((await store.observe(tokensKey, "counter"))?.count).toBe(reported);
		expect(await store.observe(slotsKey, "slots")).toBeNull();
	});

	test("a stream that ends with no usage report is charged its whole reservation", async () => {
		const store = createMemoryRateLimitStore();
		await __setRateLimitStoreForTest(store);
		const { cookie } = await signUp();
		const upstream = provider([STOP]);

		const response = await generate(cookie);
		upstream.release();
		expect(usageOf(await response.text())).toBe(0);

		/** At least the output cap, and the input estimate on top: unknown is not zero. */
		const charged = (await store.observe(tokensKey, "counter"))?.count ?? 0;
		expect(charged).toBeGreaterThan(CHAT_DEFAULT_OUTPUT_TOKENS);
		expect(await store.observe(slotsKey, "slots")).toBeNull();
	});

	test("a client that leaves mid-stream is charged in full and frees its slot", async () => {
		const store = createMemoryRateLimitStore();
		await __setRateLimitStoreForTest(store);
		const { cookie } = await signUp();
		provider([STOP, USAGE]);

		/** Leaving is the request's signal aborting (tab closed, route left), as in production. */
		const leave = new AbortController();
		const response = await generate(cookie, request(), leave.signal);
		const reader = response.body?.getReader();
		await reader?.read();
		expect((await store.observe(slotsKey, "slots"))?.count).toBe(1);
		leave.abort();
		await reader?.cancel().catch(() => {});
		await tick();

		expect(await store.observe(slotsKey, "slots")).toBeNull();
		expect(
			(await store.observe(tokensKey, "counter"))?.count ?? 0,
		).toBeGreaterThan(CHAT_DEFAULT_OUTPUT_TOKENS);
	});

	test("a provider failure midway is charged in full; a failure before streaming is not charged", async () => {
		const store = createMemoryRateLimitStore();
		await __setRateLimitStoreForTest(store);
		const { cookie } = await signUp();

		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response("nope", { status: 502 }),
		);
		const refused = await generate(cookie);
		expect(refused.status).toBe(502);
		await refused.text();
		expect((await store.observe(tokensKey, "counter"))?.count ?? 0).toBe(0);
		expect(await store.observe(slotsKey, "slots")).toBeNull();

		vi.restoreAllMocks();
		vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
			new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(sse([DELTA]));
						controller.error(new Error("socket hang up"));
					},
				}),
				{ status: 200, headers: { "content-type": "text/event-stream" } },
			),
		);
		const broken = await generate(cookie);
		expect(broken.status).toBe(200);
		expect(await broken.text()).toContain('"type":"error"');
		expect(
			(await store.observe(tokensKey, "counter"))?.count ?? 0,
		).toBeGreaterThan(CHAT_DEFAULT_OUTPUT_TOKENS);
		expect(await store.observe(slotsKey, "slots")).toBeNull();
	});
});

describe.skipIf(!databaseReady)("instance ceilings — refusals", () => {
	test("simultaneous members get exactly the instance's slots, and the next one a 429", async () => {
		const store = createMemoryRateLimitStore();
		await __setRateLimitStoreForTest(store);
		const members = await Promise.all([signUp(), signUp(), signUp()]);
		const upstream = heldProvider([STOP, USAGE]);

		const open = await Promise.all(
			Array.from({ length: SLOTS.max }, (_, i) =>
				generate((members[i % members.length] as { cookie: string }).cookie),
			),
		);
		expect(open.map((response) => response.status)).toEqual(
			Array(SLOTS.max).fill(200),
		);

		const extra = await generate((members[0] as { cookie: string }).cookie);
		expect(extra.status).toBe(429);
		expect(extra.headers.get("Retry-After")).toBe("5");
		expect(await extra.json()).toMatchObject({
			code: CHAT_ERROR_CODE.rateLimited,
		});
		expect(upstream.calls()).toBe(SLOTS.max);

		upstream.release();
		await Promise.all(open.map((response) => response.text()));
		expect(await store.observe(slotsKey, "slots")).toBeNull();

		const after = await generate((members[1] as { cookie: string }).cookie);
		expect(after.status).toBe(200);
		upstream.release();
		await after.text();
	});

	test("a spent budget is a 429 with its own code, holds no slot, and a retry is not charged twice", async () => {
		const memory = createMemoryRateLimitStore();
		let refuseOnce = true;
		const spent: RateLimitStore = {
			...memory,
			kind: "memory",
			consume: async (key, windowMs, cost) => {
				if (key === tokensKey && refuseOnce) {
					refuseOnce = false;
					return { count: TOKENS.max + 1, resetMs: windowMs };
				}
				return memory.consume(key, windowMs, cost);
			},
			release: (key, amount) => memory.release(key, amount),
			acquire: (key, holder, max, leaseMs) =>
				memory.acquire(key, holder, max, leaseMs),
			releaseHolder: (key, holder) => memory.releaseHolder(key, holder),
			observe: (key, kind) => memory.observe(key, kind),
			close: () => memory.close(),
		};
		await __setRateLimitStoreForTest(spent);
		const { cookie } = await signUp();
		const upstream = provider([STOP, USAGE]);

		const refused = await generate(cookie);
		expect(refused.status).toBe(429);
		expect(await refused.json()).toMatchObject({
			code: CHAT_ERROR_CODE.managedBudgetExhausted,
		});
		expect(upstream.calls()).toBe(0);
		expect(await memory.observe(slotsKey, "slots")).toBeNull();

		const retried = await generate(cookie);
		upstream.release();
		const reported = usageOf(await retried.text());
		expect((await memory.observe(tokensKey, "counter"))?.count).toBe(reported);
	});

	test("a counter store that cannot be read refuses — the ceilings are fail-closed", async () => {
		const memory = createMemoryRateLimitStore();
		await __setRateLimitStoreForTest({
			...memory,
			kind: "redis",
			consume: (key, windowMs, cost) => memory.consume(key, windowMs, cost),
			release: (key, amount) => memory.release(key, amount),
			acquire: () => Promise.reject(new Error("ECONNREFUSED 10.0.0.5:6379")),
			releaseHolder: () => Promise.reject(new Error("ECONNREFUSED")),
			observe: () => Promise.reject(new Error("ECONNREFUSED")),
			close: () => memory.close(),
		});
		const { cookie } = await signUp();
		const upstream = provider([STOP, USAGE]);

		const response = await generate(cookie);
		expect(response.status).toBe(503);
		expect(upstream.calls()).toBe(0);
	});

	test("a request above the per-call ceiling is a 413 before anything is held", async () => {
		const store = createMemoryRateLimitStore();
		await __setRateLimitStoreForTest(store);
		const { cookie } = await signUp();
		const upstream = provider([STOP, USAGE]);

		const response = await generate(
			cookie,
			request({
				system: "x".repeat(200_000),
				messages: Array.from({ length: 5 }, (_, i) => ({
					role: i % 2 ? "assistant" : "user",
					content: "y".repeat(40_000),
				})),
			}),
		);
		expect(response.status).toBe(413);
		expect(await response.json()).toMatchObject({
			code: CHAT_ERROR_CODE.managedRequestTooLarge,
		});
		expect(upstream.calls()).toBe(0);
		expect(await store.observe(slotsKey, "slots")).toBeNull();
		expect(await store.observe(tokensKey, "counter")).toBeNull();
	});
});

describe.skipIf(!databaseReady)("the console's budget report", () => {
	const operator = async (role: "staff" | "admin") => {
		const account = await createTestMember(EMAIL_PREFIX, { name: role });
		await db
			.update(member)
			.set({ role })
			.where(eq(member.id, account.memberId));
		return account;
	};
	const report = (cookie: string) =>
		Promise.resolve(
			app.request("/v2/admin/generation/budget", {
				headers: { Origin: "http://localhost:3002", Cookie: cookie },
			}),
		);

	test("members get 403; staff read limits, use and blockers — and nothing else", async () => {
		const store = createMemoryRateLimitStore();
		await __setRateLimitStoreForTest(store);
		expect((await report((await signUp()).cookie)).status).toBe(403);

		const { cookie } = await operator("staff");
		const upstream = provider([STOP, USAGE]);
		const streamed = await generate(cookie);
		upstream.release();
		const reported = usageOf(await streamed.text());

		const response = await report(cookie);
		expect(response.status).toBe(200);
		expect(response.headers.get("Cache-Control")).toContain("private");
		const body = (await response.json()) as ManagedGenerationBudgetDto;
		expect(Object.keys(body).sort()).toEqual(
			[
				"access",
				"blockers",
				"concurrency",
				"configured",
				"dailyTokens",
				"perMember",
				"requestTokenLimit",
				"store",
			].sort(),
		);
		expect(body.dailyTokens).toMatchObject({
			used: reported,
			limit: TOKENS.max,
		});
		expect(body.concurrency).toEqual({ active: 0, limit: SLOTS.max });
		expect(body.blockers).toEqual([]);
		expect(JSON.stringify(body)).not.toMatch(/sk-|Bearer|openrouter/i);
	});

	test("an unreadable store reads as unknown and as a blocker, never as an empty budget", async () => {
		const memory = createMemoryRateLimitStore();
		await __setRateLimitStoreForTest({
			...memory,
			kind: "redis",
			consume: (key, windowMs, cost) => memory.consume(key, windowMs, cost),
			release: (key, amount) => memory.release(key, amount),
			acquire: (key, holder, max, leaseMs) =>
				memory.acquire(key, holder, max, leaseMs),
			releaseHolder: (key, holder) => memory.releaseHolder(key, holder),
			observe: () => Promise.reject(new Error("ECONNREFUSED")),
			close: () => memory.close(),
		});
		const { cookie } = await operator("admin");

		const body = (await (
			await report(cookie)
		).json()) as ManagedGenerationBudgetDto;
		expect(body.dailyTokens.used).toBeNull();
		expect(body.concurrency.active).toBeNull();
		expect(body.blockers).toContain("store_unavailable");
	});
});
