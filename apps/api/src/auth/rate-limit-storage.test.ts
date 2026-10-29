import { describe, expect, it } from "vitest";
import {
	type AuthRateLimitRedis,
	createRedisAuthRateLimitStorage,
} from "./rate-limit-storage.ts";

/** Fakes only `eval`; that is the whole contract. */
function fakeRedis(
	script: (key: string, windowMs: number) => [number, number],
) {
	return {
		eval: async (_lua: string, _n: number, key: string, windowMs: string) =>
			script(key, Number(windowMs)),
	} satisfies AuthRateLimitRedis;
}

describe("Redis storage for the Better Auth limiter", () => {
	it("passes while under the limit", async () => {
		const storage = createRedisAuthRateLimitStorage(
			fakeRedis(() => [3, 9_000]),
		);
		await expect(storage.consume("k", { window: 10, max: 3 })).resolves.toEqual(
			{ allowed: true, retryAfter: null },
		);
	});

	it("over the limit, returns the remaining window rounded up to seconds", async () => {
		const storage = createRedisAuthRateLimitStorage(
			fakeRedis(() => [4, 1_500]),
		);
		await expect(storage.consume("k", { window: 10, max: 3 })).resolves.toEqual(
			{ allowed: false, retryAfter: 2 },
		);
	});

	it("prefixes the key and passes the window in milliseconds", async () => {
		let seen: [string, number] | null = null;
		const storage = createRedisAuthRateLimitStorage(
			fakeRedis((key, windowMs) => {
				seen = [key, windowMs];
				return [1, windowMs];
			}),
		);
		await storage.consume("no-trusted-ip|/sign-in/email", {
			window: 10,
			max: 3,
		});
		expect(seen).toEqual(["ba-rl:v1:no-trusted-ip|/sign-in/email", 10_000]);
	});

	it("passes when the storage is down — a limiter outage does not become a sign-in outage", async () => {
		const storage = createRedisAuthRateLimitStorage(
			fakeRedis(() => {
				throw new Error("down");
			}),
		);
		await expect(storage.consume("k", { window: 10, max: 3 })).resolves.toEqual(
			{ allowed: true, retryAfter: null },
		);
	});
});
