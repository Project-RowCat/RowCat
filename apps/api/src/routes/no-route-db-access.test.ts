import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * Statically scans that routes never touch the database directly. Routes own wire parsing, auth and
 * HTTP translation; services own relational operations.
 *
 * The boundary used to be an unenforced convention: `routes/me/index.ts` updated the member row
 * directly and those lines forced a second copy of `auth/viewer.ts`'s viewer projection. Such drift
 * is invisible in review (one `db.update(...)` is always the shortest code in place) and no test
 * fails until the two projections diverge.
 *
 * `health.ts` is exempt: the readiness probe's job is checking the DB.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));

/**
 * Paths into the database; importing any of them means the route touches relations. Matching the
 * tail (`db/...`) rather than a whole relative path is deliberate: routes live in folders (`me/`,
 * `stories/`, `admin/`), and a full relative path would silently miss `../../db/client.ts` one
 * level down.
 */
const FORBIDDEN = [
	{ specifier: "drizzle-orm", exact: true, why: "query builder" },
	{ specifier: "db/client.ts", exact: false, why: "connection pool" },
	{ specifier: "db/schema.ts", exact: false, why: "table definitions" },
	{ specifier: "db/tables/", exact: false, why: "table definitions" },
];

/** The readiness probe checks dependencies by definition. */
const EXEMPT = new Set(["health.ts"]);

/** Recursive: a shallow read would skip every route under `me/`, `stories/` and `admin/` while staying green. */
const walk = (dir: string, found: string[] = []): string[] => {
	for (const entry of readdirSync(dir)) {
		const full = join(dir, entry);
		if (statSync(full).isDirectory()) walk(full, found);
		else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts"))
			found.push(full);
	}
	return found;
};

const routeFiles = walk(HERE)
	.map((file) => relative(HERE, file))
	.filter((name) => !EXEMPT.has(name))
	.sort();

describe("routes don't touch the database directly", () => {
	/** An empty list guards nothing. The floor exceeds the top-level route count so losing the recursion breaks this first. */
	test("the routes to scan actually exist", () => {
		expect(routeFiles.length).toBeGreaterThan(20);
	});

	test.each(routeFiles)("%s", (name) => {
		const source = readFileSync(join(HERE, name), "utf8");
		/** Only imports are blocked; mentioning these paths in comments is fine. */
		const imports = [
			...source.matchAll(/^import\s[\s\S]*?from\s+"([^"]+)"/gm),
		].map((m) => m[1] ?? "");
		const violations = imports.filter((specifier) =>
			FORBIDDEN.some((f) => {
				if (f.exact) return specifier === f.specifier;
				return f.specifier.endsWith("/")
					? specifier.includes(`/${f.specifier}`)
					: specifier.endsWith(`/${f.specifier}`);
			}),
		);
		expect({ name, violations }).toEqual({ name, violations: [] });
	});
});
