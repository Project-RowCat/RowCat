import { describe, expect, it } from "vitest";
import {
	collectRuntimeAssetReferences,
	countRuntimeAssetReferences,
	findRuntimeAssetReferences,
	runtimeAssetLiteralAt,
	runtimeAssetReferenceAt,
} from "./source.ts";

/**
 * Tests for the lexical scanner that finds asset("…") literals.
 *
 * This file guards the direction in which the scanner is wrong. Missing a case only hides
 * autocomplete, but over-matching shows image names from comments and plain strings. That is why
 * there are more tests asserting 'not a context' than 'is a context'.
 */

/**
 * The cursor position is written as `|` in the test source. Counting offsets by hand would have to
 * be redone whenever a test changes.
 */
function at(marked: string): { source: string; offset: number } {
	const offset = marked.indexOf("|");
	expect(offset, "needs a cursor marker").toBeGreaterThanOrEqual(0);
	return { source: marked.replace("|", ""), offset };
}

const contextAt = (marked: string) => {
	const { source, offset } = at(marked);
	return runtimeAssetLiteralAt(source, offset);
};

describe("completion context", () => {
	it("a context stands in an empty string", () => {
		expect(contextAt('const a = asset("|");')).toEqual({
			start: 17,
			end: 17,
			text: "",
		});
	});

	it("accepts all three quotes", () => {
		for (const marked of [
			'asset("characters/|")',
			"asset('characters/|')",
			"asset(`characters/|`)",
		])
			expect(contextAt(marked), marked).not.toBeNull();
	});

	it("the replacement range is **inside** the quotes", () => {
		const { source, offset } = at('asset("characters/|sena")');
		const context = runtimeAssetLiteralAt(source, offset);
		expect(context).not.toBeNull();
		/** Replacing that range with an item must keep the surrounding parentheses and quotes intact. */
		const next =
			source.slice(0, context?.start) +
			"backgrounds/library" +
			source.slice(context?.end);
		expect(next).toBe('asset("backgrounds/library")');
	});

	it("replaces the whole literal even with the cursor in the middle", () => {
		const { source, offset } = at('asset("characters/|XXX/smile")');
		const context = runtimeAssetLiteralAt(source, offset);
		expect(context?.text).toBe("characters/XXX/smile");
	});

	it("a call written over several lines is a context too", () => {
		expect(
			contextAt('<Image\n  source={asset(\n    "characters/|",\n  )}\n/>'),
		).not.toBeNull();
	});

	/**
	 * Monaco autocomplete items accept only single-line ranges, and a multi-line range errors at that
	 * spot. Logical names cannot contain newlines, so treating a multi-line literal as no context
	 * loses nothing.
	 */
	it("a literal crossing lines is not a context", () => {
		expect(contextAt("asset(`characters/\nsena/|smile`)")).toBeNull();
		/** A string left open on a previous line and cut off is treated the same way. */
		expect(contextAt("asset(`characters/\nsena/|smile")).toBeNull();
	});

	it("an unclosed string's range stops at that line", () => {
		const { source, offset } = at('asset("characters/|\nconst other = 1;');
		const context = runtimeAssetLiteralAt(source, offset);
		expect(context?.text).toBe("characters/");
		expect(source.slice(context?.end)).toBe("\nconst other = 1;");
	});
});

describe("places that are not a context", () => {
	it.each([
		["plain string", 'const message = "characters/|";'],
		["line comment", '// asset("characters/|")'],
		["block comment", '/*\nasset("characters/|")\n*/'],
		["call inside a string", `const x = 'asset("characters/|")';`],
		["another function", 'translate("characters/|")'],
		["second argument", 'asset("a/b", "characters/|")'],
		["member call", 'obj.asset("characters/|")'],
		["console", 'console.log("characters/|")'],
	])("%s", (_name, marked) => {
		expect(contextAt(marked)).toBeNull();
	});

	/**
	 * A template with a substitution is not a context. Showing the list there would let the picked
	 * item erase `${face}`, an edit the author did not ask for.
	 */
	it("template with substitutions", () => {
		// biome-ignore lint/suspicious/noTemplateCurlyInString: This `${…}` is input from the author's source, not one of our templates.
		expect(contextAt("asset(`characters/sena/|${face}`)")).toBeNull();
		// biome-ignore lint/suspicious/noTemplateCurlyInString: This `${…}` is input from the author's source, not one of our templates.
		expect(contextAt("asset(`characters/|sena/${face}.png`)")).toBeNull();
	});

	it("a template without substitutions is a context; it's the same text", () => {
		expect(contextAt("asset(`characters/|sena/smile`)")).not.toBeNull();
	});

	it("does not stand outside the string (on the quote)", () => {
		expect(contextAt('asset(|"characters/sena/smile")')).toBeNull();
	});
});

describe("static references", () => {
	const SOURCE = [
		'const a = asset("characters/sena/smile");',
		'const b = asset("characters/sena/smile");',
		'const c = "characters/sena/smile";',
		// biome-ignore lint/suspicious/noTemplateCurlyInString: This `${…}` is input from the author's source, not one of our templates.
		"const d = asset(`characters/sena/${face}`);",
		'// asset("characters/sena/smile")',
		'const e = asset("https://cdn.example.com/a.webp");',
	].join("\n");

	it("counts only directly written calls", () => {
		expect(
			countRuntimeAssetReferences(
				[{ content: SOURCE }],
				"characters/sena/smile",
			),
		).toBe(2);
	});

	it("remote URLs aren't in this list", () => {
		expect(
			collectRuntimeAssetReferences(SOURCE).map((reference) => reference.path),
		).toEqual(["characters/sena/smile", "characters/sena/smile"]);
	});

	it("adds up several files", () => {
		expect(
			countRuntimeAssetReferences(
				[
					{ content: 'asset("ui/heart")' },
					{ content: 'asset("ui/heart")\nasset("ui/star")' },
					{ content: "" },
				],
				"ui/heart",
			),
		).toBe(2);
	});

	it("a missing name is 0, not a failure", () => {
		expect(countRuntimeAssetReferences([{ content: SOURCE }], "ui/heart")).toBe(
			0,
		);
	});

	it("answers the name under the cursor", () => {
		const { source, offset } = at('asset("characters/sena/|smile")');
		expect(runtimeAssetReferenceAt(source, offset)?.path).toBe(
			"characters/sena/smile",
		);
	});

	it("answers nothing over a remote URL", () => {
		const { source, offset } = at('asset("https://creator.example/|a.png")');
		expect(runtimeAssetReferenceAt(source, offset)).toBeNull();
	});
});

/**
 * If the lexical state drifts, the scanner shifts for the rest of the file. The cases here are
 * shapes that can really cause a shift, and the one requirement is that it must not over-match.
 */
describe("lexical state", () => {
	it("a comment marker inside a string opens no comment", () => {
		expect(
			countRuntimeAssetReferences(
				[{ content: 'const u = "// not a comment";\nasset("ui/heart");' }],
				"ui/heart",
			),
		).toBe(1);
	});

	it("a quote inside a regex opens no string", () => {
		expect(
			countRuntimeAssetReferences(
				[{ content: 'const re = /"/;\nasset("ui/heart");' }],
				"ui/heart",
			),
		).toBe(1);
	});

	it("also finds calls inside template substitutions", () => {
		expect(
			countRuntimeAssetReferences(
				// biome-ignore lint/suspicious/noTemplateCurlyInString: This `${…}` is input from the author's source, not one of our templates.
				[{ content: 'const t = `${asset("ui/heart")}`;' }],
				"ui/heart",
			),
		).toBe(1);
	});

	it("an escaped quote does not close the string", () => {
		expect(
			countRuntimeAssetReferences(
				[{ content: 'const s = "a\\"b";\nasset("ui/heart");' }],
				"ui/heart",
			),
		).toBe(1);
	});
});

/**
 * Finds references before a rename or removal. It uses the same scanner and never edits the source.
 * A mistake would either tell the user a name is unused while it is used, inviting deletion, or
 * count a comment example as a usage and point the author to the wrong line.
 */
describe("findRuntimeAssetReferences", () => {
	const MAIN = [
		'import { asset, Image } from "@rowcat/runtime";',
		'// asset("characters/sena/smile") is an example in a comment and is not counted',
		'const a = <Image source={asset("characters/sena/smile")} />;',
		// biome-ignore lint/suspicious/noTemplateCurlyInString: This `${…}` is input from the author's source, not one of our templates.
		"const b = asset(`characters/sena/${face}`);",
		'const c = "characters/sena/smile";',
	].join("\n");
	const SCENE = 'export const s = asset("characters/sena/smile");';

	it("gives directly written places by file, line and column, in file path order", () => {
		const report = findRuntimeAssetReferences(
			[
				{ path: "src/scene.tsx", content: SCENE },
				{ path: "src/main.tsx", content: MAIN },
			],
			"characters/sena/smile",
		);
		expect(report.sites).toEqual([
			{ file: "src/main.tsx", line: 3, column: 33 },
			{ file: "src/scene.tsx", line: 1, column: 25 },
		]);
	});

	/**
	 * An assembled name cannot be known to be this name. Such calls are counted separately and not as
	 * usages.
	 */
	it("assembled names are counted separately", () => {
		const report = findRuntimeAssetReferences(
			[{ path: "src/main.tsx", content: MAIN }],
			"ui/heart",
		);
		expect(report).toEqual({ sites: [], assembled: 1 });
	});

	it("the count matches reference counting; it's the same scanner", () => {
		const files = [
			{ path: "src/main.tsx", content: MAIN },
			{ path: "src/scene.tsx", content: SCENE },
		];
		expect(
			findRuntimeAssetReferences(files, "characters/sena/smile").sites.length,
		).toBe(countRuntimeAssetReferences(files, "characters/sena/smile"));
	});

	it("CRLF is one line break too", () => {
		expect(
			findRuntimeAssetReferences(
				[{ path: "a.ts", content: '\r\nasset("ui/heart")' }],
				"ui/heart",
			).sites,
		).toEqual([{ file: "a.ts", line: 2, column: 8 }]);
	});
});
