import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as runtime from "@rowcat/runtime";
import { describe, expect, test } from "vitest";
import { RUNTIME_DOC_ENTRIES } from "#/generated/runtime-docs.ts";
import {
	collectPublicBarrelExports,
	type PublicBarrelExport,
} from "#/test/runtime-public-barrel.ts";
import {
	RUNTIME_API_CATEGORIES,
	RUNTIME_API_CATEGORY_PAGE,
	RUNTIME_PUBLIC_API,
	type RuntimeApiSymbol,
} from "./runtime-api-inventory.ts";

/**
 * Drift guard for the public API: do three sources name the same things?
 *
 *   packages/runtime/src/index.ts    actual exports (syntax tree plus the loaded module object)
 *   runtime-api-inventory.ts         classified inventory
 *   docs/public/runtime/reference/*  `symbols` front matter on each page (generated)
 *
 * Each failure names the symbol involved. A message like 'undocumented public export: useFoo' tells
 * the fixer what to do; a raw toEqual diff does not.
 */

const INDEX_FILE = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"..",
	"..",
	"..",
	"packages",
	"runtime",
	"src",
	"index.ts",
);

/**
 * Reads the exports of `index.ts` as syntax; a regex would be fooled even by a comment line.
 *
 * The collector throws when it meets a non-barrel statement (direct declarations, `export *`,
 * `export default`, and so on). The list therefore cannot be wrong by being empty or short, and
 * every test below relies on that completeness.
 */
function actualExports(): PublicBarrelExport[] {
	return collectPublicBarrelExports(
		readFileSync(INDEX_FILE, "utf8"),
		"packages/runtime/src/index.ts",
	);
}

const inventoryByName = new Map<string, RuntimeApiSymbol>(
	RUNTIME_PUBLIC_API.map((symbol) => [symbol.name, symbol]),
);

describe("public API inventory", () => {
	test("no name appears twice in the inventory", () => {
		const names = RUNTIME_PUBLIC_API.map((symbol) => symbol.name);
		const duplicates = names.filter(
			(name, index) => names.indexOf(name) !== index,
		);
		expect(
			duplicates,
			`duplicate names in the inventory: ${duplicates.join(", ")}`,
		).toEqual([]);
	});

	test("every public export is in the inventory; a missing one breaks by name", () => {
		const missing = actualExports().filter(
			(actual) => !inventoryByName.has(actual.name),
		);
		expect(
			missing,
			`public Runtime exports without docs: ${missing
				.map((symbol) => `${symbol.name} (${symbol.kind})`)
				.join(
					", ",
				)} — classify them in runtime-api-inventory.ts and add them to that page's symbols`,
		).toEqual([]);
	});

	test("every inventory name is really exported; a removed API must leave the docs too", () => {
		const actual = new Set(actualExports().map((symbol) => symbol.name));
		const stale = RUNTIME_PUBLIC_API.filter(
			(symbol) => !actual.has(symbol.name),
		);
		expect(
			stale,
			`names no longer exported remain in the inventory: ${stale
				.map((symbol) => symbol.name)
				.join(", ")}`,
		).toEqual([]);
	});

	test("the value/type split matches index.ts", () => {
		const wrong = actualExports().filter(
			(actual) => inventoryByName.get(actual.name)?.kind !== actual.kind,
		);
		expect(
			wrong,
			`names with a different kind: ${wrong.map((symbol) => `${symbol.name} is ${symbol.kind}`).join(", ")}`,
		).toEqual([]);
	});

	test("value exports exactly match the runtime module object", () => {
		const runtimeValues = new Set(Object.keys(runtime));
		const inventoryValues = new Set(
			RUNTIME_PUBLIC_API.filter((symbol) => symbol.kind === "value").map(
				(symbol) => symbol.name,
			),
		);
		const undocumented = [...runtimeValues].filter(
			(name) => !inventoryValues.has(name),
		);
		const phantom = [...inventoryValues].filter(
			(name) => !runtimeValues.has(name),
		);
		expect(
			undocumented,
			`values in the module but not the inventory: ${undocumented.join(", ")}`,
		).toEqual([]);
		expect(
			phantom,
			`values in the inventory but not the module: ${phantom.join(", ")}`,
		).toEqual([]);
	});
});

describe("doc ownership", () => {
	const ownerOf = new Map<string, string>();
	for (const entry of RUNTIME_DOC_ENTRIES)
		for (const symbol of entry.symbols) ownerOf.set(symbol, entry.slug);

	test("every category has a page and that page exists", () => {
		for (const category of RUNTIME_API_CATEGORIES) {
			const slug = RUNTIME_API_CATEGORY_PAGE[category];
			expect(
				RUNTIME_DOC_ENTRIES.some((entry) => entry.slug === slug),
				`category ${category} has no page ${slug}`,
			).toBe(true);
		}
	});

	test("every inventory name is owned by its category's page", () => {
		const orphans = RUNTIME_PUBLIC_API.filter(
			(symbol) =>
				ownerOf.get(symbol.name) !== RUNTIME_API_CATEGORY_PAGE[symbol.category],
		);
		expect(
			orphans,
			`public API no doc owns: ${orphans
				.map(
					(symbol) =>
						`${symbol.name} → add to the symbols of ${RUNTIME_API_CATEGORY_PAGE[symbol.category]} (current owner: ${ownerOf.get(symbol.name) ?? "none"})`,
				)
				.join("; ")}`,
		).toEqual([]);
	});

	test("every name the docs mention is real public API; describing a missing one breaks", () => {
		const ghosts = [...ownerOf.entries()].filter(
			([name]) => !inventoryByName.has(name),
		);
		expect(
			ghosts,
			`docs own an API that does not exist: ${ghosts
				.map(([name, slug]) => `${name} (${slug})`)
				.join(", ")}`,
		).toEqual([]);
	});
});
