/**
 * @vitest-environment jsdom
 */
import { beforeAll, describe, expect, it } from "vitest";
import { waitForTokenizer } from "#/test/monaco-dom.ts";
import { configureRuntimeMonaco, TS_LANGUAGE_ID } from "./monaco-setup.ts";

/**
 * Regression measured with the real Monaco tokenizer.
 *
 * Other approaches prove nothing here. Counting theme rules does not show they are used, and
 * counting grammar states does not show they are reached. This tokenizes source and inspects the
 * tokens that come out.
 *
 * The .ts suffix on token names is the grammar's tokenPostfix. Theme matching is by dot-separated
 * prefix, so keyword matches keyword.ts, and the assertions use prefixes for the same reason.
 */

const SOURCE = {
	basics: [
		"const count: number = 12;",
		'const text = "hello";',
		"// comment",
		"function increment(value: number) {",
		"\treturn value + 1;",
		"}",
	].join("\n"),
	types: [
		"type Character = { name: string };",
		"interface Face { url: string }",
		"const frozen = value as const;",
		"function identity<T>(value: T): T { return value; }",
		"const seen: readonly string[] = [];",
	].join("\n"),
	jsx: [
		"const view = (",
		'\t<Stack gap={12} title="hi">',
		"\t\t<Text>{name}</Text>",
		"\t</Stack>",
		");",
	].join("\n"),
};

describe("lexical tokens", () => {
	let tokenize: (text: string) => { offset: number; type: string }[][];

	beforeAll(async () => {
		const monaco = configureRuntimeMonaco();
		await waitForTokenizer(
			(text, language) => monaco.editor.tokenize(text, language),
			TS_LANGUAGE_ID,
		);
		tokenize = (text) => monaco.editor.tokenize(text, TS_LANGUAGE_ID);
	}, 60_000);

	/**
	 * Returns the scope of the token at this line and column. Exact positions are asserted as values,
	 * so a drift of one column shows up as a wrong scope.
	 */
	const scopeAt = (source: string, line: number, column: number): string => {
		const tokens = tokenize(source)[line] ?? [];
		let found = "";
		for (const token of tokens) if (token.offset <= column) found = token.type;
		return found;
	};

	const scopes = (source: string): Set<string> => {
		const all = new Set<string>();
		for (const line of tokenize(source))
			for (const token of line) if (token.type) all.add(token.type);
		return all;
	};

	/**
	 * Not a single category. This catches a grammar that never loads at all; every line then comes
	 * back as one empty token.
	 */
	it("plain TypeScript splits into several categories", () => {
		expect(scopes(SOURCE.basics).size).toBeGreaterThan(4);
	});

	it.each([
		["keyword", 0, 0, "keyword"],
		["type name", 0, 13, "keyword"],
		["number", 0, 22, "number"],
		["string", 1, 13, "string"],
		["comment", 2, 0, "comment"],
		["function name", 3, 9, "identifier"],
		["punctuation", 5, 0, "delimiter"],
	])("%s", (_label, line, column, expected) => {
		expect(scopeAt(SOURCE.basics, line, column)).toMatch(
			new RegExp(`^${expected}\\b`),
		);
	});

	it("TypeScript-specific syntax does not fold into plain text", () => {
		const found = scopes(SOURCE.types);
		expect(found).toContain("keyword.ts");
		expect(found).toContain("type.identifier.ts");
		/**
		 * The two words in `as const` are both keywords. If either falls through to identifier, the
		 * difference is easy to miss.
		 */
		expect(scopeAt(SOURCE.types, 2, 21)).toBe("keyword.ts");
		expect(scopeAt(SOURCE.types, 2, 24)).toBe("keyword.ts");
	});

	/**
	 * If a generic is read as a JSX opening tag, the rest of the file becomes markup (this happened).
	 * The last line is also checked to be plain TypeScript, since that is this regression's symptom.
	 */
	it("generics are not read as opening tags", () => {
		expect(scopeAt(SOURCE.types, 3, 17)).toBe("delimiter.angle.ts");
		expect(scopeAt(SOURCE.types, 3, 18)).toBe("type.identifier.ts");
		expect(scopeAt(SOURCE.types, 4, 0)).toBe("keyword.ts");
	});

	it("comments and strings win over keywords", () => {
		const source = [
			"// return const function",
			'const s = "return const";',
		].join("\n");
		expect(scopeAt(source, 0, 3)).toBe("comment.ts");
		expect(scopeAt(source, 1, 12)).toBe("string.ts");
	});

	it("expressions inside template literals do not fold into the string", () => {
		// biome-ignore lint/suspicious/noTemplateCurlyInString: the string under test is the grammar itself.
		const source = "const t = `Hello ${name}!`;";
		expect(scopeAt(source, 0, 11)).toBe("string.ts");
		expect(scopeAt(source, 0, 17)).toBe("delimiter.bracket.ts");
		expect(scopeAt(source, 0, 19)).toBe("identifier.ts");
		expect(scopeAt(source, 0, 24)).toBe("string.ts");
	});

	/** A regex literal that colors the next line makes the rest of the file's colors go wrong. */
	it("a regex literal does not break what follows", () => {
		const source = ["const matcher = /asset\\([\"']/g;", "const n = 42;"].join(
			"\n",
		);
		expect(scopeAt(source, 0, 17)).toMatch(/^regexp/);
		expect(scopeAt(source, 1, 0)).toBe("keyword.ts");
		expect(scopeAt(source, 1, 10)).toBe("number.ts");
	});
});

/**
 * The reason this slice touches the grammar at all.
 *
 * Monaco's official TypeScript grammar has no JSX state (measured in 0.56.0). The gap is more than
 * a dull palette: one quote in body text turns the rest of the line into string.invalid.
 */
describe("TSX tokens", () => {
	let tokenize: (text: string) => { offset: number; type: string }[][];

	beforeAll(async () => {
		const monaco = configureRuntimeMonaco();
		await waitForTokenizer(
			(text, language) => monaco.editor.tokenize(text, language),
			TS_LANGUAGE_ID,
		);
		tokenize = (text) => monaco.editor.tokenize(text, TS_LANGUAGE_ID);
	}, 60_000);

	const scopeAt = (source: string, line: number, column: number): string => {
		const tokens = tokenize(source)[line] ?? [];
		let found = "";
		for (const token of tokens) if (token.offset <= column) found = token.type;
		return found;
	};

	it("opening tags, attribute names and attribute values have their own categories", () => {
		expect(scopeAt(SOURCE.jsx, 1, 1)).toBe("delimiter.angle.ts");
		expect(scopeAt(SOURCE.jsx, 1, 2)).toBe("tag.ts");
		expect(scopeAt(SOURCE.jsx, 1, 8)).toBe("attribute.name.ts");
		expect(scopeAt(SOURCE.jsx, 1, 13)).toBe("number.ts");
		expect(scopeAt(SOURCE.jsx, 1, 17)).toBe("attribute.name.ts");
		expect(scopeAt(SOURCE.jsx, 1, 24)).toBe("attribute.value.ts");
	});

	it("a closing tag reverts the open state", () => {
		expect(scopeAt(SOURCE.jsx, 3, 3)).toBe("tag.ts");
		/**
		 * If this cannot be restored, everything from here to the end of the file is treated as body
		 * text.
		 */
		expect(scopeAt(SOURCE.jsx, 4, 0)).toBe("delimiter.parenthesis.ts");
	});

	it("nested JSX does not clump into one color", () => {
		const line = tokenize(SOURCE.jsx)[2] ?? [];
		expect(new Set(line.map((token) => token.type)).size).toBeGreaterThan(3);
	});

	it("inside `{ … }` is TypeScript again", () => {
		const source = '\t\t<Text>{cond ? "yes" : count + 1}</Text>';
		expect(scopeAt(source, 0, 8)).toBe("delimiter.bracket.ts");
		expect(scopeAt(source, 0, 9)).toBe("identifier.ts");
		expect(scopeAt(source, 0, 16)).toBe("string.ts");
		expect(scopeAt(source, 0, 32)).toBe("number.ts");
	});

	/**
	 * This line is the reason for this extension. In the official grammar, `'t stop</Text>` becomes
	 * entirely string.invalid, and a backtick or block-comment opener keeps its state open into the
	 * next line.
	 */
	it("quotes, backticks and comment openers in text open no state", () => {
		const source = [
			"\t\t<Text>Don't stop `x` /* y</Text>",
			'const after = "still a string";',
		].join("\n");
		expect(scopeAt(source, 0, 12)).toBe("");
		expect(scopeAt(source, 0, 20)).toBe("");
		expect(scopeAt(source, 1, 0)).toBe("keyword.ts");
		expect(scopeAt(source, 1, 15)).toBe("string.ts");
	});

	it("fragments and dotted names are tags", () => {
		const source = ["<>", "\t<Foo.Bar x={1} />", "</>"].join("\n");
		expect(scopeAt(source, 0, 0)).toBe("delimiter.angle.ts");
		expect(scopeAt(source, 1, 2)).toBe("tag.ts");
		expect(scopeAt(source, 1, 10)).toBe("attribute.name.ts");
		expect(scopeAt(source, 2, 0)).toBe("delimiter.angle.ts");
	});

	/**
	 * Attributes starting on the line after the opening tag is this repo's default (Biome formats that
	 * way).
	 */
	it("an opening tag spanning lines continues", () => {
		const source = ["<Image", "\tsource={face}", "/>", "const n = 1;"].join(
			"\n",
		);
		expect(scopeAt(source, 0, 1)).toBe("tag.ts");
		expect(scopeAt(source, 1, 1)).toBe("attribute.name.ts");
		expect(scopeAt(source, 2, 0)).toBe("delimiter.angle.ts");
		expect(scopeAt(source, 3, 0)).toBe("keyword.ts");
	});

	/**
	 * Typing leaves the document unclosed almost every frame. That is the normal state, not an edge
	 * case.
	 */
	it("even unfinished TSX colors its beginning", () => {
		const source = [
			"export default function App() {",
			"\treturn (",
			"\t\t<Screen>",
			"\t\t\t<Text>{value}</Text>",
		].join("\n");
		expect(scopeAt(source, 0, 0)).toBe("keyword.ts");
		expect(scopeAt(source, 2, 3)).toBe("tag.ts");
		expect(scopeAt(source, 3, 4)).toBe("tag.ts");
	});

	/**
	 * Do not depend on whitespace the formatter inserts. The official symbol rule greedily matched
	 * `=><`, so `<Text/>` lost its chance to open a tag. Biome folds `() => <Text />` into a shape
	 * that hides this, so the bug stayed unnoticed. A grammar that is only correct after formatting
	 * cannot be explained to its author. Both shapes must give the same answer.
	 */
	it.each([
		["arrow with spaces", "const render = () => <Text />;", 21, 22],
		["arrow without spaces", "const render = ()=><Text />;", 19, 20],
	])("JSX after %s is an opening tag", (_label, source, angle, tag) => {
		expect(scopeAt(source, 0, angle)).toBe("delimiter.angle.ts");
		expect(scopeAt(source, 0, tag)).toBe("tag.ts");
	});

	it("a fragment after an arrow without spaces also opens", () => {
		const source = ["const f = ()=><>x</>;", "const after = 1;"].join("\n");
		expect(scopeAt(source, 0, 14)).toBe("delimiter.angle.ts");
		expect(scopeAt(source, 1, 0)).toBe("keyword.ts");
	});

	/** The rule that takes arrows alone must not affect other operators. */
	it.each([
		["a >>= 2;", 2],
		["const b = a >= 1;", 12],
		["const c = a <= 1;", 12],
	])("the operator in `%s` is unchanged", (source, column) => {
		expect(scopeAt(source, 0, column)).toBe("delimiter.ts");
	});

	/**
	 * The only way to write a generic arrow in TSX (`<T,>`) must not read as an opening tag. If it
	 * did, the rest of the file would become body text, and the symptom would show on the last line.
	 */
	it("a generic arrow is not JSX", () => {
		const source = [
			"const identity = <T,>(value: T): T => value;",
			"const view = <Text>hi</Text>;",
		].join("\n");
		expect(scopeAt(source, 0, 17)).toBe("delimiter.angle.ts");
		expect(scopeAt(source, 0, 18)).toBe("type.identifier.ts");
		/** Real JSX in the same file is still a tag. */
		expect(scopeAt(source, 1, 13)).toBe("delimiter.angle.ts");
		expect(scopeAt(source, 1, 14)).toBe("tag.ts");
	});

	it.each([
		["call type arguments", "const [c] = useState<number>(0);", 20, 21],
		[
			"constructor type arguments",
			"const m = new Map<string, number>();",
			17,
			18,
		],
	])("%s is not JSX", (_label, source, angle, inner) => {
		const full = [source, "const after = 1;"].join("\n");
		expect(scopeAt(full, 0, angle)).toBe("delimiter.angle.ts");
		expect(scopeAt(full, 0, inner)).toBe("keyword.ts");
		expect(scopeAt(full, 1, 0)).toBe("keyword.ts");
	});

	/**
	 * What remains here is one color, not a state. Whether `a<B` is a comparison or a generic call
	 * needs the type of `a`, and Monarch is not a parser, so `B` takes the type-name color. This spot
	 * was once far costlier: `a <B` at the end of a line was read as an opening tag, and the rest of
	 * the file became an attribute list. The assertions below guard against that returning.
	 */
	it.each([
		["comparison without spaces", "const c = a<B", 12],
		["comparison with spaces", "const c = a <B", 13],
	])("%s does not leak onto the next line", (_label, first, column) => {
		const source = [first, "const after = 1;", 'const s = "x";'].join("\n");
		/** The remaining ambiguity: one value takes the type-name color. */
		expect(scopeAt(source, 0, column)).toBe("type.identifier.ts");
		/** The whole point of this regression is that nothing leaks into the following lines. */
		expect(scopeAt(source, 1, 0)).toBe("keyword.ts");
		expect(scopeAt(source, 1, 14)).toBe("number.ts");
		expect(scopeAt(source, 2, 10)).toBe("string.ts");
	});

	it("inside a spread attribute is TypeScript again", () => {
		const source = ["<Component {...props} />", "const after = 1;"].join("\n");
		expect(scopeAt(source, 0, 1)).toBe("tag.ts");
		expect(scopeAt(source, 0, 11)).toBe("delimiter.bracket.ts");
		expect(scopeAt(source, 0, 15)).toBe("identifier.ts");
		expect(scopeAt(source, 1, 0)).toBe("keyword.ts");
	});

	/** If a hyphen splits the name, data and -kind would fall into different categories. */
	it("a hyphenated attribute name is one token", () => {
		const source = '<Component data-kind="x" />';
		expect(scopeAt(source, 0, 11)).toBe("attribute.name.ts");
		expect(scopeAt(source, 0, 16)).toBe("attribute.name.ts");
		expect(scopeAt(source, 0, 21)).toBe("attribute.value.ts");
	});

	/**
	 * If the braces inside `{ … }` are not counted, the first `}` of an inner object returns the
	 * tokenizer to attribute state, and the values after it are colored as attribute names.
	 */
	it("counts nested braces inside an expression", () => {
		const source = ["<C value={{ n: { c: 1 } }} />", "const after = 1;"].join(
			"\n",
		);
		expect(scopeAt(source, 0, 17)).toBe("identifier.ts");
		expect(scopeAt(source, 0, 20)).toBe("number.ts");
		expect(scopeAt(source, 0, 27)).toBe("delimiter.angle.ts");
		expect(scopeAt(source, 1, 0)).toBe("keyword.ts");
	});

	/** A self-closing tag leaves attribute state and returns to normal TypeScript. */
	it("after a self-closing tag is plain TypeScript", () => {
		const source = ["<Image source={face} />", "const after = 1;"].join("\n");
		expect(scopeAt(source, 0, 21)).toBe("delimiter.angle.ts");
		expect(scopeAt(source, 1, 0)).toBe("keyword.ts");
		expect(scopeAt(source, 1, 14)).toBe("number.ts");
	});

	it("a dotted name is a tag in a closing tag too", () => {
		const source = [
			'<UI.Panel title="h">',
			"\t<UI.Text>Hi</UI.Text>",
			"</UI.Panel>",
			"const after = 1;",
		].join("\n");
		expect(scopeAt(source, 0, 1)).toBe("tag.ts");
		expect(scopeAt(source, 1, 14)).toBe("tag.ts");
		expect(scopeAt(source, 2, 2)).toBe("tag.ts");
		expect(scopeAt(source, 3, 0)).toBe("keyword.ts");
	});

	/** A comment in the body sits inside `{ }`, so it is a real comment. */
	it("a comment expression in text is a comment", () => {
		const source = [
			"<Screen>",
			"\t{/* note */}",
			"</Screen>",
			"const after = 1;",
		].join("\n");
		expect(scopeAt(source, 1, 2)).toBe("comment.ts");
		expect(scopeAt(source, 3, 0)).toBe("keyword.ts");
	});
});

/**
 * A whole file, written the way authors actually write. The regressions above check one grammar
 * feature at a time. This checks whether the features return the state to normal when they share a
 * file. The fixture contains everything this slice fixed: quotes, backticks, a block-comment opener
 * in body text, arrows without spaces, generic calls, multi-line opening tags, and nested braces.
 * The last line must be plain TypeScript; a leak from any of them shows there first.
 */
const FIXTURE = [
	"import {",
	"\tButton,",
	"\tImage,",
	"\tScreen,",
	"\tStack,",
	"\tText,",
	"\tasset,",
	"\tuseState,",
	'} from "@rowcat/runtime";',
	"",
	"interface Character {",
	"\tname: string;",
	"\tface: string;",
	"}",
	"",
	"const DEFAULT_CHARACTER: Character = {",
	'\tname: "Sena",',
	'\tface: "characters/sena/smile",',
	"};",
	"",
	"export default function App() {",
	"\tconst [count, setCount] = useState<number>(0);",
	"",
	"\tconst renderBadge = ()=><Text>Count: {count}</Text>;",
	"",
	"\treturn (",
	"\t\t<Screen>",
	"\t\t\t{/* Character information */}",
	"\t\t\t<Stack gap={12}>",
	"\t\t\t\t<Image",
	"\t\t\t\t\tsource={asset(DEFAULT_CHARACTER.face)}",
	"\t\t\t\t\talt={DEFAULT_CHARACTER.name}",
	"\t\t\t\t/>",
	"",
	"\t\t\t\t<Text>",
	"\t\t\t\t\tDon't stop using `code` here /* this is text */",
	"\t\t\t\t</Text>",
	"",
	"\t\t\t\t{renderBadge()}",
	"",
	"\t\t\t\t<Button",
	"\t\t\t\t\tonPress={() => {",
	"\t\t\t\t\t\tsetCount((value) => value + 1);",
	"\t\t\t\t\t}}",
	"\t\t\t\t>",
	"\t\t\t\t\tIncrement",
	"\t\t\t\t</Button>",
	"\t\t\t</Stack>",
	"\t\t</Screen>",
	"\t);",
	"}",
	"",
	"const after = 1;",
].join("\n");

describe("one fixture sheet", () => {
	let tokenize: (text: string) => { offset: number; type: string }[][];

	beforeAll(async () => {
		const monaco = configureRuntimeMonaco();
		await waitForTokenizer(
			(text, language) => monaco.editor.tokenize(text, language),
			TS_LANGUAGE_ID,
		);
		tokenize = (text) => monaco.editor.tokenize(text, TS_LANGUAGE_ID);
	}, 60_000);

	/** The scope of the given word on that line, so the test does not count columns. */
	const at = (source: string, line: number, needle: string): string => {
		const text = source.split("\n")[line] ?? "";
		const column = text.indexOf(needle);
		expect(column, `${needle} is not on line ${line}`).toBeGreaterThanOrEqual(
			0,
		);
		let found = "";
		for (const token of tokenize(source)[line] ?? [])
			if (token.offset <= column) found = token.type;
		return found;
	};

	it.each([
		["import keyword", 0, "import", "keyword.ts"],
		["declared type name", 10, "Character", "type.identifier.ts"],
		["string in an object", 16, '"Sena"', "string.ts"],
		["primitive in a type argument", 21, "number", "keyword.ts"],
		["tag after an arrow without spaces", 23, "Text", "tag.ts"],
		["comment in text", 27, "/* Character", "comment.ts"],
		["attribute name", 28, "gap", "attribute.name.ts"],
		["name of a multi-line opening tag", 29, "Image", "tag.ts"],
		["call inside an expression", 30, "asset", "identifier.ts"],
		["prose in text", 35, "Don't", ""],
		["backtick in text", 35, "`code`", ""],
		["comment opener in text", 35, "/* this", ""],
		["nested arrow body", 42, "setCount", "identifier.ts"],
		["number in a nested arrow", 42, "1", "number.ts"],
		["closing tag name", 47, "Stack", "tag.ts"],
	])("%s", (_label, line, needle, expected) => {
		expect(at(FIXTURE, line as number, needle as string)).toBe(expected);
	});

	/** If any one of these leaks, this line reports it first. */
	it("the end of the file is plain TypeScript", () => {
		expect(at(FIXTURE, 50, "}")).toBe("delimiter.bracket.ts");
		expect(at(FIXTURE, 52, "const")).toBe("keyword.ts");
		expect(at(FIXTURE, 52, "1")).toBe("number.ts");
	});

	/**
	 * Source being typed is almost always unclosed somewhere. Required here is not exact colors but
	 * three things: no throwing, no loss of colors before the break, and the same input gives the same
	 * output.
	 */
	it.each(
		FIXTURE.split("\n").map((_line, index) => index),
	)("holds up with only %i lines written", (lines) => {
		const partial = FIXTURE.split("\n")
			.slice(0, lines + 1)
			.join("\n");
		const first = tokenize(partial);
		expect(first.length).toBe(lines + 1);
		/** Deterministic: measuring twice gives the same result. */
		expect(tokenize(partial)).toEqual(first);
		expect(first[0]?.[0]?.type).toBe("keyword.ts");
	});

	/** Fragments that stay unclosed are held to the same standard. */
	it.each([
		"const view = <Stack",
		"const view = (\n\t<Stack>\n\t\t<Text>Hello",
		"const view = <Text>{cond ?",
		"const f = ()=>",
		"const x: Map<",
		"<",
		"</",
		"<>",
	])("`%s` does not throw and is deterministic", (source) => {
		const first = tokenize(source);
		expect(first).toEqual(tokenize(source));
		expect(first.length).toBe(source.split("\n").length);
	});
});
