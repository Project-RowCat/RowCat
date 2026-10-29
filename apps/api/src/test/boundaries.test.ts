import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * The test harness stays out of the product dependency graph.
 *
 * `src/test/` connects to a real Postgres, holds fixed passwords and swaps the mail transport; any
 * of that in the runtime bundle is a vulnerability. Tree shaking removes it today only because the
 * bundle has the single entry `src/index.ts`, which is a build-config fact rather than a boundary,
 * and one import would silently flip it.
 */

const SRC = fileURLToPath(new URL("..", import.meta.url));

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

describe("product code doesn't import the test harness", () => {
	test("the files to scan actually exist", () => {
		expect(productionFiles.length).toBeGreaterThan(50);
	});

	test("no import points at src/test/*", () => {
		const violations = productionFiles.filter((file) =>
			/from\s+"[^"]*\/test\/[^"]+"/.test(readFileSync(file, "utf8")),
		);
		expect(violations.map((f) => f.slice(SRC.length))).toEqual([]);
	});
});

/**
 * Tests never call `db.delete` on a table without a `.where` predicate.
 *
 * Isolation comes from the per-worker database (`worker-database.ts`), not from these files; a run
 * that could not create its database falls back to the shared address (sequential, so safe), and
 * when those two facts disagree only the predicate is left. A failure from deleting someone else's
 * rows surfaces in the victim, not the deleter: `services/push/delivery.test.ts` once emptied both
 * push tables in `beforeEach`, and the failure landed in `services/push/enqueue.test.ts`, which saw
 * 0 and could not say why.
 *
 * Ownership is expressed one way: a predicate through members created with the test prefix
 * (`testMemberIds`), or a value this suite created itself (such as a delivery `source_key`).
 */
describe("test cleanup has predicates", () => {
	/**
	 * Only tables with no owner axis are exempt. Feature switches and the version floor are
	 * deployment-wide settings, not member children, so there is no predicate to narrow with
	 * (`ops.ts`). Adding a name here claims the table has no owner axis; the schema decides whether
	 * that is true.
	 */
	const OWNERLESS_TABLES = new Set([
		"ops_feature_flag",
		"ops_app_version_floor",
	]);

	const testFiles = (dir: string, found: string[] = []): string[] => {
		for (const entry of readdirSync(dir)) {
			const full = join(dir, entry);
			if (statSync(full).isDirectory()) testFiles(full, found);
			else if (entry.endsWith(".test.ts")) found.push(full);
		}
		return found;
	};

	const files = testFiles(SRC);

	test("the test files to scan actually exist", () => {
		expect(files.length).toBeGreaterThan(50);
	});

	test("tables with an ownership axis are never deleted without a predicate", () => {
		const violations: string[] = [];
		for (const file of files) {
			const source = readFileSync(file, "utf8");
			for (const match of source.matchAll(
				/\.delete\(\s*([A-Za-z_]\w*)\s*\)(?!\s*\.where\b)/g,
			)) {
				const table = match[1] ?? "";
				if (OWNERLESS_TABLES.has(table)) continue;
				violations.push(`${file.slice(SRC.length)}: delete(${table})`);
			}
		}
		expect(violations).toEqual([]);
	});
});
