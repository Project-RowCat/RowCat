import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Feature code issues no Redis commands and keeps no counters of its own. Without this boundary
 * what this slice removed comes back: one `redis.incr(...)` in a service is the shortest code at
 * that spot, every test passes, and it surfaces only when that spot forgot expiry and an account
 * got blocked permanently (`routes/no-route-db-access.test.ts` catches the same kind of drift the
 * same way).
 *
 * Three things are scanned:
 *
 * ```text
 * ioredis / lib/redis.ts import   must not appear outside approved infrastructure
 * in-process counter revival      Map<string, number[]> + window arithmetic coming back
 * retryAfterSeconds hand-assembly the Object.assign(error, {...}) convention coming back
 * ```
 *
 * There are two Redis consumers (the server cache in `lib/cache/` is the second), so the allowlist
 * is files rather than folders: exempting the folder would let any file in it hold the connection
 * as it grows. Listing approved files one by one makes the list the picture below, and a change to
 * the picture is a change to the array, visible in review. It is narrower than the old folder
 * exemption, so adding the cache loosened nothing (`limiter.ts`, `policy.ts`, `store.ts` and
 * `memory-store.ts` are now checked like any other file).
 *
 * ```text
 * lib/redis.ts
 *    |-> lib/rate-limit/index.ts        assembly point
 *    |     `-> lib/rate-limit/redis-store.ts   adapter (type import only)
 *    `-> lib/cache/index.ts             assembly point
 *          `-> lib/cache/redis-store.ts        adapter
 * ```
 */

const SRC = fileURLToPath(new URL("../..", import.meta.url));
const RATE_LIMIT_DIR = join("lib", "rate-limit");

function sourceFiles(dir: string, found: string[] = []): string[] {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) {
			if (entry === "test") continue;
			sourceFiles(full, found);
		} else if (
			(entry.endsWith(".ts") || entry.endsWith(".tsx")) &&
			!entry.endsWith(".test.ts")
		) {
			found.push(full);
		}
	}
	return found;
}

const productionFiles = sourceFiles(SRC);
const rel = (file: string) => file.slice(SRC.length);

/**
 * Excluded from the feature scan: the infrastructure itself.
 *
 * ```text
 * lib/rate-limit/*   policy, port, adapters, limiter (definitions, not uses)
 * lib/errors.ts      how 429 and 503 are built (`tooManyRequests` lives here)
 * ```
 *
 * `lib/redis.ts` is not listed here: `REDIS_CONSUMERS` allows it separately, and the other checks
 * (counters, 429) still apply to it; a connection factory may not count its own counters.
 */
const INFRA = new Set([join("lib", "errors.ts")]);
const featureFiles = productionFiles.filter(
	(file) => !file.includes(RATE_LIMIT_DIR) && !INFRA.has(rel(file)),
);

/**
 * Where Redis may be touched, file by file. The diagram in the header is this array; adding a name
 * is the decision to create a third consumer, and it must not be made silently by a folder
 * exemption.
 */
const REDIS_CONSUMERS = new Set([
	join("lib", "redis.ts"),
	join("lib", "rate-limit", "index.ts"),
	join("lib", "rate-limit", "redis-store.ts"),
	join("lib", "cache", "index.ts"),
	join("lib", "cache", "redis-store.ts"),
	/** Assembly point plugging in the Better Auth limiter storage. Its adapter (`auth/rate-limit-storage.ts`) takes a one-command structural type instead of importing `ioredis`; the connection still comes from `lib/redis.ts` alone. */
	join("auth", "index.ts"),
]);
const nonRedisFiles = productionFiles.filter(
	(file) => !REDIS_CONSUMERS.has(rel(file)),
);

describe("rate-limit boundary", () => {
	test("the files to scan actually exist", () => {
		expect(featureFiles.length).toBeGreaterThan(50);
	});

	/** Importing `ioredis` directly creates a second connection-config path (one deployment with TLS, one without). */
	test("nothing imports ioredis outside the approved adapters", () => {
		const violations = nonRedisFiles.filter((file) =>
			/^import\s[\s\S]*?from\s+"ioredis"/m.test(readFileSync(file, "utf8")),
		);
		expect(violations.map(rel)).toEqual([]);
	});

	/** Importing the connection is blocked too: holding it is one step from calling `INCR`/`EXPIRE` directly, and then key rules and expiry appear per call site. */
	test("nothing imports lib/redis.ts outside the approved assembly points", () => {
		const violations = nonRedisFiles.filter((file) =>
			/from\s+"[^"]*\/redis\.ts"/.test(readFileSync(file, "utf8")),
		);
		expect(violations.map(rel)).toEqual([]);
	});

	/** Feature code must not assemble cache adapters: calling `createRedisCacheStore(client)` means holding the connection, and TTL and key rules would spread per call site. The one door is `lib/cache/index.ts`. */
	test("the cache adapter is assembled only at the assembly point", () => {
		const violations = nonRedisFiles.filter((file) =>
			/createRedisCacheStore|createRedisRateLimitStore/.test(
				readFileSync(file, "utf8"),
			),
		);
		expect(violations.map(rel)).toEqual([]);
	});

	/** Blocks Redis command names in feature code; the next shape after import bypass is taking the client as an argument (`(redis: Redis) => redis.incr(...)`). */
	test("feature code does not call Redis commands", () => {
		/** `setex` and `psetex` are listed since the cache arrived: they attach a TTL to a value rather than count, and `redis.psetex(key, 30_000, json)` would bypass the cache slice's key rules, versioning and interpretation. */
		const forbidden =
			/\.(incr|incrby|pexpire|pttl|evalsha|setex|psetex|getex)\s*\(/;
		const violations = featureFiles.filter((file) =>
			forbidden.test(readFileSync(file, "utf8")),
		);
		expect(violations.map(rel)).toEqual([]);
	});

	/** `routes/guardian.ts` once had exactly this shape (`Map<string, number[]>` + window arithmetic) and could not count across replicas. Its return means a spot that believes a limiter exists while running without one. */
	test("there is no timestamp-array counter", () => {
		const violations = featureFiles.filter((file) =>
			/new Map<string,\s*number\[\]>/.test(readFileSync(file, "utf8")),
		);
		expect(violations.map(rel)).toEqual([]);
	});

	/**
	 * The old convention was `Object.assign(error, { retryAfterSeconds })`, with three copies of the
	 * reader. Now `ApiError` carries the value and `app.ts` attaches the header; reviving the old
	 * convention yields a 429 that does not state the wait, and that path is outside the types so it
	 * would not survive refactoring.
	 */
	test("the old convention of putting retryAfterSeconds on errors is gone", () => {
		const violations = featureFiles.filter((file) =>
			/Object\.assign\(\s*error\s*,\s*\{\s*[\s\S]{0,80}retryAfterSeconds/.test(
				readFileSync(file, "utf8"),
			),
		);
		expect(violations.map(rel)).toEqual([]);
	});

	/** Only the limiter builds 429s. Feature code counting its own windows and assembling 429s would scatter the ceilings again, as before this slice. */
	test("feature code does not build a 429 itself", () => {
		/** Checking only `new ApiError(429` is not enough; wrapping in a local helper (`pairingError(429, …)`) escapes it, so the shape scanned is 429 passed as an argument. */
		const violations = featureFiles.filter((file) =>
			/\(\s*429\s*,/.test(readFileSync(file, "utf8")),
		);
		/** `services/sync/pairing.ts` is the exception: its 429 is a ceiling on state (open pairing sessions), decided by a row-counting query, which a limiter cannot replace (`pairingTooMany` vs `pairingRateLimited`). */
		expect(violations.map(rel)).toEqual([
			join("services", "sync", "pairing.ts"),
		]);
	});
});
