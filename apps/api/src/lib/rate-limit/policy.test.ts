import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { RATE_LIMIT_POLICIES, type RateLimitPolicy } from "./policy.ts";

/**
 * Checks the policy table's invariants and that the table is actually used. The latter is the
 * point: a policy name with no checking caller blocks nothing while looking like it does, the same
 * rule this repository has for moderation capabilities and feature-switch keys (AGENTS.md, "do not
 * grow the vocabulary without a route that checks it").
 */

const SRC = fileURLToPath(new URL("../..", import.meta.url));

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

/** Excludes the policy folder itself: names appearing here are definitions, not uses. */
const consumers = sourceFiles(SRC).filter(
	(file) => !file.includes(join("lib", "rate-limit")),
);
const consumerSource = consumers.map((file) => readFileSync(file, "utf8"));

const entries = Object.entries(RATE_LIMIT_POLICIES);

describe("policy table", () => {
	test("the files to scan actually exist", () => {
		expect(consumers.length).toBeGreaterThan(50);
		expect(entries.length).toBeGreaterThan(0);
	});

	/**
	 * The name is the store key namespace. If two collide they share one counter, with symptoms like
	 * "writing a comment blocks reporting" that nobody can guess the cause of.
	 */
	test("names don't collide", () => {
		const names = entries.map(([, p]) => p.name);
		expect(new Set(names).size).toBe(names.length);
	});

	test("names have a key-safe shape", () => {
		for (const [key, p] of entries) {
			expect(p.name, key).toMatch(/^[a-z0-9-]+$/);
		}
	});

	test("limits and windows are positive", () => {
		for (const [key, p] of entries) {
			expect(p.max, key).toBeGreaterThan(0);
			expect(Number.isInteger(p.max), key).toBe(true);
			expect(p.windowMs, key).toBeGreaterThan(0);
		}
	});

	test("every policy has a code and a message", () => {
		for (const [key, p] of entries) {
			expect(p.code, key).not.toBe("");
			expect(p.message, key).not.toBe("");
		}
	});

	/**
	 * No policy name without a checking caller. Without this the table accumulates names that were
	 * once used, and a reader cannot tell what this deployment actually blocks.
	 */
	test.each(
		entries.map(([key]) => key),
	)("policy %s has a place that actually checks it", (key) => {
		/**
		 * Looks for the policy name appearing, not the call shape. Searching only `checkRateLimit("...")`
		 * would miss callers that receive the limiter by injection, which is ordinary dependency
		 * inversion rather than the drift this guards against. What it catches is a name nobody calls.
		 */
		const used = consumerSource.some((source) => source.includes(`"${key}"`));
		expect(used).toBe(true);
	});
});

describe("failure policy", () => {
	/**
	 * fail-open/fail-closed is a deliberate choice, so the table must contain both. If every policy
	 * were on one side it would be a default rather than an axis, and removing the axis would be the
	 * honest move.
	 */
	test("both modes are actually used", () => {
		const modes = new Set(entries.map(([, p]) => p.onStoreFailure));
		expect(modes.has("allow")).toBe(true);
		expect(modes.has("deny")).toBe(true);
	});

	/**
	 * Identity-verification paths that make paid external calls fail closed: running without the
	 * limiter would turn the endpoint into an amplifier of the authority's quota.
	 */
	test("identity verification paths are fail-closed", () => {
		expect(RATE_LIMIT_POLICIES.guardianVerify.onStoreFailure).toBe("deny");
		expect(RATE_LIMIT_POLICIES.adultVerification.onStoreFailure).toBe("deny");
	});

	/**
	 * Managed generation fails closed. It was once open on the grounds that a balance reservation
	 * stood behind it; with metering gone these two policies are what remains protecting the
	 * operator's key, and passing while the store is down would open it without a ceiling.
	 */
	test("managed generation is fail-closed", () => {
		expect(RATE_LIMIT_POLICIES.managedGeneration.onStoreFailure).toBe("deny");
		expect(RATE_LIMIT_POLICIES.managedGenerationDaily.onStoreFailure).toBe(
			"deny",
		);
	});

	/** Comments and reports stay open: closing them would shut the feature on any Redis blip. */
	test("always-on product paths are fail-open", () => {
		expect(RATE_LIMIT_POLICIES.storyCommentCreate.onStoreFailure).toBe("allow");
		expect(RATE_LIMIT_POLICIES.reportCreate.onStoreFailure).toBe("allow");
	});
});

/**
 * Moved-over limits must stay unchanged. Putting infrastructure and product-rule changes in one
 * commit leaves nobody able to say which caused a user-visible change. These three values are the
 * old `BURST` in `services/comments.ts`, `REPORT_BURST` in `services/moderation.ts` and
 * `VERIFY_BURST` in `routes/guardian.ts`.
 */
describe("migrated limits are preserved", () => {
	test("comments — 5 / 30 seconds", () => {
		expect(RATE_LIMIT_POLICIES.storyCommentCreate.max).toBe(5);
		expect(RATE_LIMIT_POLICIES.storyCommentCreate.windowMs).toBe(30_000);
		expect(RATE_LIMIT_POLICIES.storyCommentCreate.subject).toBe("member");
	});

	test("reports — 10 / 10 minutes", () => {
		expect(RATE_LIMIT_POLICIES.reportCreate.max).toBe(10);
		expect(RATE_LIMIT_POLICIES.reportCreate.windowMs).toBe(600_000);
	});

	test("guardian identity verification — 10 / 10 minutes / verified requests", () => {
		expect(RATE_LIMIT_POLICIES.guardianVerify.max).toBe(10);
		expect(RATE_LIMIT_POLICIES.guardianVerify.windowMs).toBe(600_000);
		expect(RATE_LIMIT_POLICIES.guardianVerify.subject).toBe(
			"guardian-consent-request",
		);
	});

	/**
	 * Deployed screens branch on these codes (`comment-error.ts`, `report-error.ts`). Swapping in a
	 * shared code would drop those failures into the default branch with no compile error.
	 */
	test("domain error codes are unchanged", () => {
		expect(RATE_LIMIT_POLICIES.storyCommentCreate.code).toBe(
			"comment_rate_limited",
		);
		expect(RATE_LIMIT_POLICIES.reportCreate.code).toBe("report_rate_limited");
		expect(RATE_LIMIT_POLICIES.guardianVerify.code).toBe(
			"guardian_verification_failed",
		);
	});
});

describe("units — calls and amounts", () => {
	/** Table values are `as const` with a different shape per branch and do not know `unit`, so read them by the port shape. */
	const unitOf = (p: RateLimitPolicy) => p.unit ?? "requests";
	const bytePolicies = entries.filter(([, p]) => unitOf(p) === "bytes");

	/** With no bytes policy, the assertions below would guard nothing. */
	test("a policy that counts amounts actually exists", () => {
		expect(bytePolicies.map(([key]) => key)).toEqual([
			"runtimeRemoteAssetBytes",
		]);
	});

	/**
	 * A bytes policy called through `checkRateLimit` counts each request as 1 byte and blocks nothing.
	 * The limiter also throws on the spot, but this catches the call before it reaches operation.
	 */
	test.each(
		entries.map(([key, p]) => [key, unitOf(p)] as const),
	)("%s (%s) is called only through the right door", (key, unit) => {
		const wrongDoor =
			unit === "bytes"
				? new RegExp(`checkRateLimit\\(\\s*"${key}"`)
				: new RegExp(`reserveRateLimit\\(\\s*"${key}"`);
		const offenders = consumerSource.filter((source) => wrongDoor.test(source));
		expect(offenders).toEqual([]);
	});

	/**
	 * The byte budget's numbers and their reasoning live in one place (`remote-image/budget.ts`). This
	 * checks that one premise, the number of remote images a work may declare, equals the compiler's
	 * cap. If only one changes, the stated reasoning becomes false.
	 */
	test("the declared cap the budget is based on is the compiler's value", async () => {
		const { RUNTIME_REMOTE_ASSET_MANIFEST_LIMITS } = await import(
			"@rowcat/runtime-compiler/remote-assets"
		);
		const { REMOTE_IMAGE_BUDGET } = await import("../remote-image/budget.ts");
		const { REMOTE_IMAGE_LIMITS } = await import("../remote-image/limits.ts");
		expect(RUNTIME_REMOTE_ASSET_MANIFEST_LIMITS.maxCount).toBe(256);
		/** 256 images at an average of 2 MiB once each is 512 MiB. */
		expect(REMOTE_IMAGE_BUDGET.bytesPerWindow).toBe(
			RUNTIME_REMOTE_ASSET_MANIFEST_LIMITS.maxCount * 2 * 1024 * 1024,
		);
		/** The reservation size is the response cap itself, since nothing larger can be received. */
		expect(REMOTE_IMAGE_BUDGET.reservePerRequest).toBe(
			REMOTE_IMAGE_LIMITS.maxBytes,
		);
		expect(RATE_LIMIT_POLICIES.runtimeRemoteAssetBytes.max).toBe(
			REMOTE_IMAGE_BUDGET.bytesPerWindow,
		);
	});
});
