import { describe, expect, it } from "vitest";
import {
	collectRuntimeSources,
	renderDeclarations,
} from "../../scripts/lib/declaration-sources.ts";
import { RUNTIME_PACKAGE_SOURCES as GENERATED } from "./generated.ts";
import {
	isRuntimeBuiltinSpecifier,
	RUNTIME_BUILTIN_SPECIFIERS,
	RUNTIME_PACKAGE_SOURCES,
	runtimePackageFiles,
} from "./index.ts";

/**
 * Checks that the generated output matches the source. Without this check, drift is silent: adding
 * a primitive without rerunning the generator passes types and tests, and the symptom appears only
 * when an author looks for a name that does not autocomplete, with no hint that the output is
 * stale.
 *
 * The generator is rerun and its output compared in memory; the file is not rewritten. If the check
 * changed the working tree, it would pass in CI forever and guard nothing.
 */

describe("tool assets derive from the source", () => {
	it("the output matches the current source", () => {
		const expected = renderDeclarations(collectRuntimeSources());
		const actual = renderDeclarations(GENERATED);
		expect(actual, "run `pnpm runtime:declarations` and commit along").toBe(
			expected,
		);
	});

	/**
	 * The tool asset itself must not be copied. A copy would put a second full copy of the source, as
	 * a string, inside the author's program, and that file would contain itself again.
	 */
	it("the declaration module itself is not carried over", () => {
		expect(
			RUNTIME_PACKAGE_SOURCES.map((file) => file.path).filter((path) =>
				path.startsWith("declarations/"),
			),
		).toEqual([]);
	});

	it("tests are not carried over either", () => {
		expect(
			RUNTIME_PACKAGE_SOURCES.filter((file) => file.path.includes(".test.")),
		).toEqual([]);
	});

	/**
	 * Copied files must not have a .ts extension. If they did, the author's program would need
	 * `allowImportingTsExtensions`, which is incompatible with emit.
	 */
	it("extensions dropped from relative imports", () => {
		const offenders: string[] = [];
		for (const file of RUNTIME_PACKAGE_SOURCES)
			for (const match of file.content.matchAll(/from\s+"(\.[^"]*)"/g))
				if (match[1]?.endsWith(".ts"))
					offenders.push(`${file.path}: ${match[1]}`);
		expect(offenders).toEqual([]);
	});

	it("holds the entry point and the JSX runtime", () => {
		const paths = RUNTIME_PACKAGE_SOURCES.map((file) => file.path);
		expect(paths).toContain("index.ts");
		expect(paths).toContain("jsx-runtime.ts");
		expect(paths).toContain("jsx-dev-runtime.ts");
	});
});

/**
 * The platform's names must not reach the author's program. Scroll and focus are where React would
 * place a platform object in `ref.current`; one step down that path makes `HTMLInputElement` appear
 * in the author's autocomplete, and the language contract becomes the browser's.
 *
 * The check reads the source actually shipped to authors (the generated output). Type checking does
 * not catch this: these names are undefined in our tsconfig (no lib), and an undefined name only
 * errors when it is used in a type. Leaks through strings or comments are outside that check.
 */
describe("platform names do not leak", () => {
	/**
	 * Comments are stripped before scanning. The package header names things it does not have in order
	 * to explain them (NativeSyntheticEvent, MouseEvent in 'does not cross this boundary' sentences).
	 * Forbidding the words would turn this check into pressure to delete explanations, the opposite of
	 * what this repository asks of comments.
	 */
	const code = (content: string): string =>
		content.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");

	const FORBIDDEN: readonly (readonly [RegExp, string])[] = [
		[/\bHTML[A-Za-z]*Element\b/, "DOM element types"],
		[/\bdocument\s*\./, "the DOM document"],
		[/\bwindow\s*\./, "browser globals"],
		[/\bquerySelector\b/, "selector lookup"],
		[/\bfindNodeHandle\b/, "native tags"],
		[/\bnativeTag\b/, "native tags"],
		[/\bReact\.[A-Za-z]/, "React types"],
		[/from\s+"react/, "React import"],
		[/\bNativeSyntheticEvent\b/, "RN event objects"],
	];

	it.each(FORBIDDEN)("the carried code has no %s (%s)", (pattern) => {
		const offenders = RUNTIME_PACKAGE_SOURCES.filter((file) =>
			pattern.test(code(file.content)),
		).map((file) => file.path);
		expect(offenders).toEqual([]);
	});

	/**
	 * The controller must be opaque. If an author could name the integer inside, this API would become
	 * a channel for sending commands to any host node.
	 */
	it("the controller's public type has neither a node number nor current", () => {
		const controller = RUNTIME_PACKAGE_SOURCES.find(
			(file) => file.path === "controller.ts",
		);
		expect(controller).toBeDefined();
		const source = code(controller?.content ?? "");
		for (const banned of ["nodeId", "current", "handle", "element"])
			expect(
				new RegExp(`\\b${banned}\\??\\s*:`).test(source),
				`${banned} is in the controller's public type`,
			).toBe(false);
	});
});

describe("virtual package layout", () => {
	it("placed under node_modules with a package.json", () => {
		const files = runtimePackageFiles("/root");
		expect(files[0]?.path).toBe(
			"/root/node_modules/@rowcat/runtime/package.json",
		);
		expect(files.map((file) => file.path)).toContain(
			"/root/node_modules/@rowcat/runtime/jsx-runtime.ts",
		);
	});

	it("the package.json has no exports: lets both consumers resolve the same way", () => {
		const manifest = runtimePackageFiles("/root")[0];
		expect(JSON.parse(manifest?.content ?? "{}")).not.toHaveProperty("exports");
	});
});

describe("allowlist", () => {
	it("only three", () => {
		expect([...RUNTIME_BUILTIN_SPECIFIERS]).toEqual([
			"@rowcat/runtime",
			"@rowcat/runtime/jsx-runtime",
			"@rowcat/runtime/jsx-dev-runtime",
		]);
	});

	/**
	 * The internal module really exists in the virtual file system, so this judgment is the only gate.
	 */
	it("internal modules are not allowed", () => {
		expect(
			isRuntimeBuiltinSpecifier("@rowcat/runtime/internal/dispatcher"),
		).toBe(false);
		expect(isRuntimeBuiltinSpecifier("@rowcat/runtime/declarations")).toBe(
			false,
		);
		expect(isRuntimeBuiltinSpecifier("react")).toBe(false);
	});
});
