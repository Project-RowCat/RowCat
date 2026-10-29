import { afterEach, describe, expect, test, vi } from "vitest";
import { createMemoryRateLimitStore } from "./memory-store.ts";

afterEach(() => vi.useRealTimers());

describe("memory ceiling of the in-process rate-limit store", () => {
	test("the ceiling is per policy — one policy filling its window does not stop another", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
		const store = createMemoryRateLimitStore();

		for (let index = 0; index < 4_096; index++)
			await store.consume(`rl:v1:report-create:${index}`, 60_000);
		await expect(
			store.consume("rl:v1:report-create:one-too-many", 60_000),
		).rejects.toThrow("ceiling");
		/** A fail-closed policy must not start returning 503 because of a fail-open policy being abused. */
		await expect(
			store.consume("rl:v1:managed-generation:alice", 60_000),
		).resolves.toMatchObject({ count: 1 });
		await store.close();
	});

	test("when distinct keys in one window exceed the absolute ceiling, new keys are not kept", async () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
		const store = createMemoryRateLimitStore();

		for (let index = 0; index < 4_096; index++)
			await store.consume(`rl:v1:p:key-${index}`, 60_000);
		await expect(store.consume("rl:v1:p:one-too-many", 60_000)).rejects.toThrow(
			"ceiling",
		);

		/** After the window ends, expired entries are cleared first and normal keys are accepted again. */
		vi.setSystemTime(new Date("2026-01-01T00:01:01Z"));
		await expect(
			store.consume("rl:v1:p:after-expiry", 60_000),
		).resolves.toMatchObject({
			count: 1,
		});
		await store.close();
	});
});
