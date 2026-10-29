import { RUNTIME_GENERATION_LIMITS } from "@rowcat/runtime";
import { DEFAULT_GENERATION_LIMITS } from "@rowcat/runtime-host";
import { describe, expect, test } from "vitest";
import { RUNTIME_DOC_BODIES } from "#/generated/runtime-docs-content.ts";

/**
 * The public docs state generation limits; these must match the actual policy.
 *
 * This value has drifted before: the docs shipped listing only the per-request limit, not the
 * per-run generation count. If a number lives separately in code and docs, one can change alone,
 * and the mismatch first appears to a creator on their 200th request. Three places are compared:
 *
 *   @rowcat/runtime        RUNTIME_GENERATION_LIMITS  request limit creators read (exported)
 *   @rowcat/runtime-host   DEFAULT_GENERATION_LIMITS  host policy: request plus in-run limits
 *   docs/public/runtime    numbers in the body        sentences creators read
 *
 * `@rowcat/runtime-host` is imported here only because this is a test. The docs screen's runtime
 * files cannot import it (`docs-boundaries.test.ts`). Body numbers are not injected at build time:
 * people write the sentences and this test watches the numbers.
 *
 * Two phrasing conventions: per-run counts are written `실행 … N번` (run … N times), and concurrency
 * as `동시 … N개` (N concurrent). Numbers outside those patterns are not caught here, so new sentences
 * should follow the same shape.
 */

const REQUIRED_PAGES = [
	"concepts/generation",
	"reference/generation",
	"reference/errors-and-limits",
];

const SESSION_BUDGET = /실행[^\n]*?(\d{1,3}(?:,\d{3})*)번/g;
const CONCURRENCY = /동시[^\n]*?(\d{1,3}(?:,\d{3})*)개/g;

const numbersOf = (body: string, pattern: RegExp): number[] =>
	[...body.matchAll(pattern)].map((match) =>
		Number((match[1] ?? "").replace(/,/g, "")),
	);

const bodyOf = (slug: string): string => {
	const body = RUNTIME_DOC_BODIES[slug];
	if (body === undefined) throw new Error(`no ${slug} page`);
	return body;
};

describe("request limits: the public constant and host policy", () => {
	test("every key of the public constant equals the host policy", () => {
		const host: Record<string, number> = { ...DEFAULT_GENERATION_LIMITS };
		for (const [key, value] of Object.entries(RUNTIME_GENERATION_LIMITS)) {
			if (key === "defaultOutputCharacters") continue;
			expect(host[key], key).toBe(value);
		}
	});

	test("runtime limits are not in the public constant; the docs must not invent that key", () => {
		expect(RUNTIME_GENERATION_LIMITS).not.toHaveProperty("maxPerSession");
		expect(RUNTIME_GENERATION_LIMITS).not.toHaveProperty("maxConcurrent");
	});

	test("the RUNTIME_GENERATION_LIMITS shape the reference states matches the real constant", () => {
		const body = bodyOf("reference/generation");
		const block = /const RUNTIME_GENERATION_LIMITS: \{([^}]*)\};/.exec(body);
		expect(block, "the reference has the constant's type block").not.toBeNull();
		const documented = new Map<string, number>();
		for (const line of (block?.[1] ?? "").split("\n")) {
			const entry = /^\s*([A-Za-z]+):\s*([\d_]+);\s*$/.exec(line);
			if (entry)
				documented.set(
					entry[1] ?? "",
					Number((entry[2] ?? "").replace(/_/g, "")),
				);
		}
		expect([...documented.keys()].sort()).toEqual(
			Object.keys(RUNTIME_GENERATION_LIMITS).sort(),
		);
		for (const [key, value] of Object.entries(RUNTIME_GENERATION_LIMITS))
			expect(documented.get(key), key).toBe(value);
	});
});

describe("runtime limits: the docs' numbers equal the host policy", () => {
	test.each(
		REQUIRED_PAGES,
	)("%s states the per-run generation count", (slug) => {
		expect(numbersOf(bodyOf(slug), SESSION_BUDGET).length).toBeGreaterThan(0);
	});

	test.each(REQUIRED_PAGES)("%s states the concurrency", (slug) => {
		expect(numbersOf(bodyOf(slug), CONCURRENCY).length).toBeGreaterThan(0);
	});

	test.each(
		Object.keys(RUNTIME_DOC_BODIES),
	)("every per-run count in %s is maxPerSession", (slug) => {
		for (const value of numbersOf(bodyOf(slug), SESSION_BUDGET))
			expect(value, slug).toBe(DEFAULT_GENERATION_LIMITS.maxPerSession);
	});

	test.each(
		Object.keys(RUNTIME_DOC_BODIES),
	)("every concurrency in %s is maxConcurrent", (slug) => {
		for (const value of numbersOf(bodyOf(slug), CONCURRENCY))
			expect(value, slug).toBe(DEFAULT_GENERATION_LIMITS.maxConcurrent);
	});
});

describe("runtime_generation_not_authorized states both reasons", () => {
	test.each([
		"concepts/generation",
		"reference/errors-and-limits",
	])("%s", (slug) => {
		const body = bodyOf(slug);
		const row = body
			.split("\n")
			.find(
				(line) =>
					line.includes("`runtime_generation_not_authorized`") &&
					line.startsWith("|"),
			);
		expect(row, "the table has that code's row").toBeDefined();
		expect(row).toMatch(/조작/);
		expect(row).toMatch(/횟수/);
	});
});
