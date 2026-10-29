/**
 * Extends Monaco's official TypeScript Monarch grammar with JSX instead of copying it.
 * - The official grammar has no JSX states. Quotes, backticks or `/*` in TSX text open strings or
 *   comments that run to the next line, and attributes such as `gap` become plain identifiers.
 * - The TypeScript semantic classifier skips identifiers inside JSX, so the lexical layer must
 *   color tag and attribute names.
 * - Keywords, operators and symbols are referenced from the official object, so keywords added to
 *   TypeScript arrive with a Monaco upgrade.
 * - Monarch cannot fully resolve `<` (generic or JSX) because it sees one line at a time with no
 *   lookbehind. Identifiers and `=>` consume a following `<` first, and a JSX `<` needs a
 *   capitalized name followed by a tag shape. A comparison such as `a<B` may get a wrong color on
 *   that line, but no state stays open.
 * - Diagnostics, completion, compilation and execution do not use this layer.
 */

/*
 * Two test files cover this. runtime-tokenization.test.ts measures colors with the real Monaco
 * tokenizer. The answer for this file lives there. runtime-tsx-grammar.test.ts checks what a
 * line-by-line view cannot show: the official grammar object is unmodified, repeated calls match,
 * and keyword lists are not copied.
 */

/**
 * Declares only the parts of the Monarch grammar object that the extension functions touch. Other
 * fields pass through the index signature unchanged.
 */
export interface MonarchLanguage {
	tokenizer: Record<string, unknown[]>;
	[key: string]: unknown;
}

const TAG_NAME = "[A-Z][\\w$]*(?:\\.[A-Za-z_$][\\w$]*)*";

/**
 * Lookahead that decides whether `<Name` may open a JSX tag. It accepts `>` or `/>`, an attribute
 * `name=`, a `{` (spread props), or end of line (for attributes on the following lines). A generic
 * arrow such as `<T extends object>(v: T) => v` matches none of these and is rejected.
 */
const TAG_AHEAD = "(?=\\s*\\/?>|\\s+[\\w$-]+\\s*=|\\s*\\{|\\s*$)";

/**
 * Returns a copy of the official grammar with the JSX states added. The base object is a
 * module-level singleton, so it must not be modified.
 */
export function withJsx(base: MonarchLanguage): MonarchLanguage {
	const tokenizer: Record<string, unknown[]> = {};
	for (const [state, rules] of Object.entries(base.tokenizer))
		tokenizer[state] = [...rules];

	/**
	 * Entry rules come first in `common`, and their order matters. The first two rules consume
	 * generics. An identifier followed by `<` takes that `<` with it (`Map<string>`, `f<T>()`,
	 * `useState<number>(0)`), so a JSX `<` can only appear where no identifier precedes it. Keywords
	 * skip this path: `return <Text>` is the most common JSX position, and consuming keywords would
	 * leave that whole screen uncolored.
	 *
	 * Lookbehind cannot make this decision. Monarch passes the line as `line.substr(pos)`, so the
	 * character before `<` is invisible. An earlier version read `f<T>` as an opening tag and made the
	 * rest of the file a JSX body.
	 */
	tokenizer.common = [
		[
			/#?[a-z_$][\w$]*(?=[ \t]*<(?![=<]))/,
			{
				cases: {
					"@keywords": "keyword",
					"@default": { token: "identifier", next: "@jsxGeneric" },
				},
			},
		],
		[
			/[A-Z][\w$]*(?=[ \t]*<(?![=<]))/,
			{ token: "type.identifier", next: "@jsxGeneric" },
		],
		/**
		 * Consumes `=>` on its own. The official grammar's symbol rule matches `@symbols` greedily, so
		 * `=><` becomes one token with no name, and the `<Text/>` after it never gets a chance to open a
		 * tag. The symptom disappeared when a formatter inserted a space, so it persisted for a long
		 * time. A grammar whose colors depend on formatter spacing cannot be explained to its authors, so
		 * the fix belongs in the grammar. The token gets the name the official grammar gives `=>`:
		 * `delimiter`, since it is in `@operators`.
		 */
		[/=>/, "delimiter"],
		/** Fragment `<>` is consumed in one match. A zero-length rule would loop in place in Monarch. */
		[/<>/, { token: "delimiter.angle", next: "@jsxText" }],
		[
			new RegExp(`(<)(${TAG_NAME})${TAG_AHEAD}`),
			["delimiter.angle", { token: "tag", next: "@jsxAttributes" }],
		],
		...(tokenizer.common ?? []),
	];

	/**
	 * Consumes the `<` after an identifier as a plain bracket and returns to the previous state.
	 * Spaces before the `<` are consumed too. Otherwise `a <B` (a comparison) matches the end-of-line
	 * branch of TAG_AHEAD, opens a tag, and the rest of the file is read as attributes. The entry
	 * lookahead matches `[ \t]*` and this rule matches `[ \t]+`, so both must see the same characters.
	 * No valid TSX has a tag after whitespace that follows an identifier. `return`, `yield` and
	 * `await` are keywords and take another path, and other JSX positions follow `(`, `,`, `:`, `&&`
	 * or `=>`. The `(?![=<])` lookahead leaves `<`-prefixed operators alone. Consuming the `<` in `a
	 * <= 1` or `a << 1` would split one operator into two tokens and diverge from the official
	 * grammar.
	 */
	tokenizer.jsxGeneric = [
		[/[ \t]+/, ""],
		[/</, { token: "delimiter.angle", next: "@pop" }],
	];

	/**
	 * Attributes of an opening tag. `/>` discards this state, since there are no children, and `>`
	 * switches to the body instead. Each element therefore holds exactly one state, and its closing
	 * tag pops it.
	 */
	tokenizer.jsxAttributes = [
		[/[ \t\r\n]+/, ""],
		[/\/>/, { token: "delimiter.angle", next: "@pop" }],
		[/>/, { token: "delimiter.angle", switchTo: "@jsxText" }],
		[/\{/, { token: "delimiter.bracket", next: "@jsxExpression" }],
		[/=/, "delimiter"],
		[/"[^"]*"/, "attribute.value"],
		[/'[^']*'/, "attribute.value"],
		[/[A-Za-z_$][\w$-]*/, "attribute.name"],
	];

	/**
	 * Element body. A closing tag is matched by a single rule that also pops the state. Splitting it
	 * would leave no way to say which layer `>` must return to, because Monarch's `@pop` removes only
	 * one level.
	 */
	tokenizer.jsxText = [
		[
			/(<\/)([\w$.]*)(\s*)(>)/,
			[
				"delimiter.angle",
				"tag",
				"",
				{ token: "delimiter.angle", next: "@pop" },
			],
		],
		[/<>/, { token: "delimiter.angle", next: "@jsxText" }],
		[
			new RegExp(`(<)(${TAG_NAME})`),
			["delimiter.angle", { token: "tag", next: "@jsxAttributes" }],
		],
		[/\{/, { token: "delimiter.bracket", next: "@jsxExpression" }],
		/**
		 * Body text has no token name on purpose, so prose takes the foreground color. Quotes, backticks
		 * and `/*` open no state here. Those three are what this extension fixes.
		 */
		[/[^<{]+/, ""],
		[/[<{]/, ""],
	];

	/**
	 * Inside `{ … }` the grammar is TypeScript again. It includes `common` unchanged, so nested JSX,
	 * strings, comments and regexes use the original rules. Only the braces are counted here, because
	 * `common` has no `{}` rule. That rule belongs to `root`.
	 */
	tokenizer.jsxExpression = [
		[/\}/, { token: "delimiter.bracket", next: "@pop" }],
		[/\{/, { token: "delimiter.bracket", next: "@jsxExpression" }],
		{ include: "common" },
	];

	return { ...base, tokenizer };
}
