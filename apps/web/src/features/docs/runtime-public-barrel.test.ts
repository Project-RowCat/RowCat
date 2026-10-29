import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript-compiler-api";
import { describe, expect, test } from "vitest";
import {
	collectPublicBarrelExports,
	PublicBarrelViolation,
} from "#/test/runtime-public-barrel.ts";

/**
 * `@rowcat/runtime`'s root is a barrel of named re-exports only. That is what makes the drift guard
 * complete.
 *
 * The inventory test counts every export in `index.ts` against the docs' ownership, and that count
 * is complete only if every export form is counted. Instead of widening the counter for each form,
 * the allowed shape is narrowed to one. This file checks the narrowing is enforced: two allowed
 * forms pass with fixtures, and every other form throws, naming itself.
 *
 * The last test is the reason the file exists: type-only direct declarations passed the old counter
 * (which read only `ExportDeclaration`) and must not pass again.
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
const LABEL = "packages/runtime/src/index.ts";

const collect = (source: string) => collectPublicBarrelExports(source, LABEL);

describe("public barrel: accepted shapes", () => {
	test("only named and type-only re-exports pass, and values and types are told apart", () => {
		expect(
			collect(
				[
					'/// <reference path="./globals.d.ts" />',
					"",
					'export { foo, type Foo } from "./foo.ts";',
					'export type { Bar } from "./bar.ts";',
					"",
				].join("\n"),
			),
		).toEqual([
			{ name: "foo", kind: "value" },
			{ name: "Foo", kind: "type" },
			{ name: "Bar", kind: "type" },
		]);
	});

	test("the real index.ts is a barrel with non-empty exports", () => {
		const exports = collect(readFileSync(INDEX_FILE, "utf8"));
		const names = exports.map((symbol) => symbol.name);
		expect(names.length).toBeGreaterThan(0);
		expect(names).toContain("useGeneration");
		expect(names).toContain("RuntimeErrorCode");
		expect(new Set(names).size).toBe(names.length);
	});
});

describe("public barrel: rejected shapes", () => {
	test.each([
		[
			"directly exported interface",
			"export interface Foo { value: string }",
			"Foo (InterfaceDeclaration)",
		],
		[
			"directly exported type",
			"export type Bar = string;",
			"Bar (TypeAliasDeclaration)",
		],
		[
			"directly exported const",
			"export const baz = 1;",
			"baz (VariableStatement)",
		],
		[
			"directly exported function",
			"export function qux() {}",
			"qux (FunctionDeclaration)",
		],
		[
			"directly exported class",
			"export class Quux {}",
			"Quux (ClassDeclaration)",
		],
		[
			"directly exported enum",
			"export enum Corge { A }",
			"Corge (EnumDeclaration)",
		],
		[
			"directly exported namespace",
			"export namespace Grault {}",
			"Grault (ModuleDeclaration)",
		],
		["export default", "export default 1;", "default (ExportAssignment)"],
		["export *", 'export * from "./foo.ts";', "export *"],
		["export * as", 'export * as ns from "./foo.ts";', "export * as"],
		[
			"import",
			'import { foo } from "./foo.ts";',
			'"./foo.ts" (ImportDeclaration)',
		],
		[
			"export { x } without from",
			"const x = 1;\nexport { x };",
			"x (VariableStatement)",
		],
		[
			"an unexported statement",
			"console.log(1);",
			"console.log(1); (ExpressionStatement)",
		],
	])("%s → rejected by name", (_label, offending, expected) => {
		const source = `export { ok } from "./ok.ts";\n${offending}\n`;
		expect(() => collect(source)).toThrow(PublicBarrelViolation);
		expect(() => collect(source)).toThrow(expected);
		expect(() => collect(source)).toThrow("must remain a named-export barrel");
	});
});

describe("regression: a type-only direct declaration does not slip past the docs check", () => {
	const appended = `${readFileSync(INDEX_FILE, "utf8")}\nexport interface MissingFromDocs {\n\tvalue: string;\n}\n\nexport type AnotherMissing = string;\n`;

	/**
	 * Legacy counter: reads only `export { … } from` clauses. This was the source of the false green.
	 */
	const legacyNamedExportsOnly = (source: string): string[] => {
		const file = ts.createSourceFile(
			LABEL,
			source,
			ts.ScriptTarget.ES2022,
			true,
		);
		const names: string[] = [];
		for (const statement of file.statements) {
			if (!ts.isExportDeclaration(statement)) continue;
			const clause = statement.exportClause;
			if (clause !== undefined && ts.isNamedExports(clause))
				for (const element of clause.elements) names.push(element.name.text);
		}
		return names;
	};

	test("the old count missed both names; they are absent from the runtime module object too, so both checks stayed quiet", () => {
		const seen = legacyNamedExportsOnly(appended);
		expect(seen).not.toContain("MissingFromDocs");
		expect(seen).not.toContain("AnotherMissing");
	});

	test("now that file is not a barrel and breaks naming its first direct declaration", () => {
		expect(() => collect(appended)).toThrow(PublicBarrelViolation);
		expect(() => collect(appended)).toThrow(
			"MissingFromDocs (InterfaceDeclaration)",
		);
	});

	test("the same with a single type alias as the only direct declaration", () => {
		const onlyAlias = `${readFileSync(INDEX_FILE, "utf8")}\nexport type AnotherMissing = string;\n`;
		expect(() => collect(onlyAlias)).toThrow(
			"AnotherMissing (TypeAliasDeclaration)",
		);
	});
});
