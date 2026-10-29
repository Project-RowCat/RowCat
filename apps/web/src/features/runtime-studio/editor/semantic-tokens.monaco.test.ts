/**
 * @vitest-environment jsdom
 */
import { beforeAll, describe, expect, it } from "vitest";
import { createRuntimeTsWorker } from "#/test/monaco-ts-worker.ts";
import {
	encodeSemanticTokens,
	RUNTIME_SEMANTIC_TOKEN_MODIFIERS,
	RUNTIME_SEMANTIC_TOKEN_TYPES,
} from "./semantic-tokens.ts";

/**
 * Regression that measures the semantic layer with the real TypeScript language service.
 *
 * The sibling runtime-semantic-tokens.test.ts checks the encoding by value. It cannot check whether
 * the legend order matches the real classifier, because a wrong order passes every arithmetic
 * check: the numbers are right and only the names shift by one.
 *
 * So this test runs the worker class from monaco-ts.worker.ts against real source and asks which
 * name lands on each word. No worker thread is needed. The class only requires a context that
 * supplies a mirror model; the language service inside is real.
 */

const workerFor = (fileName: string, content: string) =>
	createRuntimeTsWorker([{ uri: fileName, content }]);

const FILE = "file:///rowcat-project/__studio__/s1/src/main.tsx";

const SOURCE = [
	"interface User {",
	"\treadonly name: string;",
	"}",
	"",
	"class Store {}",
	"",
	"function render(user: User): string {",
	"\tconst local = user.name;",
	"\treturn local;",
	"}",
].join("\n");

function roleOf(
	spans: readonly number[],
	source: string,
	word: string,
	occurrence = 1,
): string | null {
	let at = -1;
	for (let seen = 0; seen < occurrence; seen += 1)
		at = source.indexOf(word, at + 1);
	for (let i = 0; i + 2 < spans.length; i += 3)
		if (spans[i] === at) {
			const classification = spans[i + 2] as number;
			return RUNTIME_SEMANTIC_TOKEN_TYPES[(classification >> 8) - 1] ?? null;
		}
	return null;
}

describe("semantic classification from the real language service", () => {
	let spans: number[];

	beforeAll(async () => {
		spans = await workerFor(FILE, SOURCE).getEncodedSemanticClassifications(
			FILE,
			0,
			SOURCE.length,
		);
	}, 60_000);

	it("classification really arrives", () => {
		expect(spans.length).toBeGreaterThan(0);
		expect(spans.length % 3).toBe(0);
	});

	/**
	 * These assertions lock the legend order. The array looks like it should be sorted alphabetically,
	 * but sorting would paint interfaces as classes and parameters as type parameters. The arithmetic
	 * would stay correct and nothing would error.
	 */
	it.each([
		["User", 1, "interface"],
		["Store", 1, "class"],
		["render", 1, "function"],
		["user", 1, "parameter"],
		["name", 2, "property"],
		["local", 1, "variable"],
	])("%s gets its name at position %s", (word, occurrence, expected) => {
		expect(roleOf(spans, SOURCE, word, occurrence as number)).toBe(expected);
	});

	/** Modifiers are checked too: readonly name arrives with its modifier bit set. */
	it("modifier bits really arrive", () => {
		const at = SOURCE.indexOf("name");
		const modifiers = (() => {
			for (let i = 0; i + 2 < spans.length; i += 3)
				if (spans[i] === at) return (spans[i + 2] as number) & 255;
			return 0;
		})();
		const named = RUNTIME_SEMANTIC_TOKEN_MODIFIERS.filter(
			(_value, bit) => (modifiers & (1 << bit)) !== 0,
		);
		expect(named).toContain("declaration");
		expect(named).toContain("readonly");
	});

	/** The values this layer draws are the ones after encoding, so the test checks them there. */
	it("comes out through the codec as Monaco's groups of five", () => {
		const data = encodeSemanticTokens(spans, (offset) => {
			const before = SOURCE.slice(0, offset).split("\n");
			return {
				line: before.length - 1,
				character: (before.at(-1) ?? "").length,
			};
		});
		expect(data.length % 5).toBe(0);
		expect(data.length).toBeGreaterThan(0);
		/** Deltas never go backward. That is the only assumption this encoding makes. */
		for (let i = 0; i < data.length; i += 5) {
			expect(data[i]).toBeGreaterThanOrEqual(0);
			expect(data[i + 1]).toBeGreaterThanOrEqual(0);
			expect(data[i + 2]).toBeGreaterThan(0);
		}
	});
});

/**
 * JSX does not reach this layer, measured with the real service. TypeScript's collector skips
 * identifiers inside a JSX element (inJSXElement), so tag and attribute name colors come from the
 * lexical layer (runtime-tsx-grammar.ts). Trying to fix JSX through the semantic layer without
 * knowing this wastes hours. This assertion exists to save that time.
 */
describe("JSX identifiers", () => {
	const jsx = [
		"declare const Screen: unknown;",
		'const view = <Screen title="hi" />;',
	].join("\n");

	it("tag names are not classified", async () => {
		const spans = await workerFor(FILE, jsx).getEncodedSemanticClassifications(
			FILE,
			0,
			jsx.length,
		);
		const starts = spans.filter((_value, index) => index % 3 === 0);
		/** Without this, the assertions below could pass vacuously. Value names do get classified. */
		expect(starts).toContain(jsx.indexOf("const Screen") + "const ".length);
		expect(starts).toContain(jsx.indexOf("view"));
		expect(starts).not.toContain(jsx.indexOf("<Screen") + 1);
		expect(starts).not.toContain(jsx.indexOf("title="));
	});
});

/**
 * An unknown file returns an empty array, not an exception. The screen then keeps its lexical
 * colors.
 */
describe("the worker's failure direction", () => {
	it("answers an unknown file with an empty array", async () => {
		expect(
			await workerFor(FILE, SOURCE).getEncodedSemanticClassifications(
				"file:///nowhere.tsx",
				0,
				10,
			),
		).toEqual([]);
	});
});
