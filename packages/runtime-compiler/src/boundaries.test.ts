import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { RUNTIME_COMPILER_VERSION } from "./contracts.ts";

/**
 * Statically checks what the compiler must NOT do.
 *
 * The package promises one thing: author code is compiled but never executed. The promise breaks in
 * a natural way. 'Let's check once that the emitted code really runs' is a reasonable request, and
 * the shortest implementation is `new Function(code)()`. Tests still pass with that.
 *
 * The breakage is quiet. The line is never removed, and when the real VM arrives it stays because
 * 'it already runs', so one of the two execution paths ends up isolated and the other is not.
 */

const HERE = fileURLToPath(new URL(".", import.meta.url));

/**
 * Comments are stripped before scanning. If a rule quoted in a comment tripped the scan, the next
 * person would fix it by deleting the explanation instead of the code.
 */
const stripComments = (source: string): string =>
	source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

function* sources(root: string): Generator<string> {
	for (const name of readdirSync(root)) {
		const path = join(root, name);
		if (statSync(path).isDirectory()) {
			yield* sources(path);
			continue;
		}
		if (!/\.ts$/.test(name) || name.includes(".test.")) continue;
		yield path;
	}
}

const files = () =>
	[...sources(HERE)].map((path) => ({
		name: path.slice(HERE.length),
		source: stripComments(readFileSync(path, "utf8")),
	}));

const FORBIDDEN: { door: RegExp; why: string }[] = [
	{
		door: /\beval\s*\(/,
		why: "the shortest path to running emitted code in this process.",
	},
	{
		door: /new\s+Function\s*\(/,
		why: "the same as `eval`, used more often because the name sounds less scary.",
	},
	{
		door: /\bnew\s+Worker\s*\(/,
		why: "the app makes the trusted compile worker. The only reason this package would make a worker is to run creator code.",
	},
	{
		door: /from\s+"node:vm"|require\(["']vm["']\)/,
		why: "Node's `vm` is not isolation: it runs in the same process.",
	},
	{
		door: /\bimport\s*\(/,
		why: "dynamic import is a path for bringing in modules unknown at compile time.",
	},
	{
		door: /<iframe|createObjectURL|innerHTML/,
		why: "the browser's execution and injection paths. There is no reason for DOM to appear in this package.",
	},
];

describe("there is no execution", () => {
	it.each(FORBIDDEN)("$door is absent from this package", ({ door, why }) => {
		const offenders = files()
			.filter((file) => door.test(file.source))
			.map((file) => file.name);
		expect(offenders, why).toEqual([]);
	});
});

describe("platform coupling", () => {
	/**
	 * If the core imports Node, it cannot be loaded in the browser. Making the studio use this package
	 * would then require splitting the package first, and splitting later costs much more.
	 */
	it("environment/ is the only file that knows Node APIs", () => {
		const offenders = files()
			.filter((file) => /from\s+"node:/.test(file.source))
			.map((file) => file.name)
			.sort();
		expect(offenders).toEqual(["environment/node.ts"]);
	});

	it("the places that bring TypeScript in as a value are narrow", () => {
		const offenders = files()
			.filter((file) =>
				/^import\s+(?!type\b)[^;]*from\s+"typescript-compiler-api"/m.test(
					file.source,
				),
			)
			.map((file) => file.name)
			.sort();
		expect(offenders).toEqual([
			"compile.ts",
			"diagnostics.ts",
			"module-graph.ts",
			"policy.ts",
			/** Static remote-asset collection walks the AST of the source, not the emitted JS. */
			"remote-assets.ts",
			"typescript-host.ts",
		]);
	});

	/** If the authoring, UI, or server packages enter this package, the layering is inverted. */
	it("brings in no authoring, UI or server packages", () => {
		const forbidden =
			/from\s+"(@rowcat\/(authoring|chat|sdk|query|ui-web|ui-native|sync|contracts|domain)|react|dexie|monaco)/;
		const offenders = files()
			.filter((file) => forbidden.test(file.source))
			.map((file) => file.name);
		expect(offenders).toEqual([]);
	});
});

describe("engine version", () => {
	/**
	 * TypeScript's version changes the emitted output, and that change does NOT bump
	 * `RUNTIME_COMPILER_VERSION` automatically. The commit that breaks this test is where the decision
	 * to bump it is made.
	 *
	 * If the version is not pinned as a value, a dependency can upgrade silently. Cached artifacts
	 * would then hash differently from what the current compile produces, yet both would claim to be
	 * compiler v1.
	 */
	it("the compile engine's version is pinned", () => {
		const require = createRequire(import.meta.url);
		const manifest = require("typescript-compiler-api/package.json") as {
			version: string;
		};
		expect(manifest.version).toBe("5.9.3");
		expect(RUNTIME_COMPILER_VERSION).toBe(1);
	});
});
