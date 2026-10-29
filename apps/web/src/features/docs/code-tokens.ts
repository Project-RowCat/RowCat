/**
 * Lexical tokenizer for code blocks. The syntax highlighting in the docs comes from here.
 * - No library. The browser bundle has no syntax highlighter (prismjs is a server-side dependency
 *   pulled in by the mail tooling). Adding one would make its theme's hex values the docs' colors,
 *   so light and dark would come from that library instead of design tokens. The docs only need
 *   TS/TSX to be readable, which a regex scanner does.
 * - Not a precise parser. Output is screen color only, never evidence for a decision. Errors fall
 *   toward plain text: an unknown token gets no color, so a mis-colored token cannot change what
 *   the code means. `${…}` inside a template literal counts as part of the string.
 * - Color is not the only signal. Keywords render bold and comments italic, so the structure
 *   survives for people who cannot tell colors apart.
 */

export type CodeTokenKind =
	| "plain"
	| "keyword"
	| "string"
	| "comment"
	| "number"
	| "punctuation"
	| "tag"
	| "attribute"
	| "type"
	| "function";

export interface CodeToken {
	kind: CodeTokenKind;
	text: string;
}

/** Languages to highlight. Any other language is rendered entirely as plain text. */
const HIGHLIGHTED = new Set(["ts", "tsx", "js", "jsx", "json"]);

const KEYWORDS = new Set([
	"as",
	"async",
	"await",
	"break",
	"case",
	"catch",
	"class",
	"const",
	"continue",
	"default",
	"delete",
	"do",
	"else",
	"export",
	"extends",
	"false",
	"finally",
	"for",
	"from",
	"function",
	"if",
	"import",
	"in",
	"instanceof",
	"interface",
	"let",
	"new",
	"null",
	"of",
	"readonly",
	"return",
	"satisfies",
	"switch",
	"this",
	"throw",
	"true",
	"try",
	"type",
	"typeof",
	"undefined",
	"var",
	"void",
	"while",
	"yield",
]);

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*/;
const NUMBER =
	/^(?:0[xX][0-9a-fA-F_]+|\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d+)?)/;
const WHITESPACE = /^\s+/;

export function tokenizeCode(code: string, language: string): CodeToken[] {
	if (!HIGHLIGHTED.has(language)) return [{ kind: "plain", text: code }];

	const tokens: CodeToken[] = [];
	let rest = code;
	/**
	 * Scanner state: the last non-whitespace token (to judge JSX tags) and whether it is inside a
	 * `<Tag` (identifiers there are attributes). It is an object because `push` is a closure. As a
	 * local variable, TypeScript's control-flow analysis would not see the assignment made inside
	 * push, and the read sites would be typed `never`.
	 */
	const state: { previous: CodeToken | null; inTag: boolean } = {
		previous: null,
		inTag: false,
	};

	const push = (kind: CodeTokenKind, text: string): void => {
		tokens.push({ kind, text });
		if (kind !== "plain" || text.trim().length > 0)
			state.previous = { kind, text };
	};

	while (rest.length > 0) {
		const space = WHITESPACE.exec(rest);
		if (space) {
			tokens.push({ kind: "plain", text: space[0] });
			rest = rest.slice(space[0].length);
			continue;
		}

		if (rest.startsWith("//")) {
			const end = rest.indexOf("\n");
			const text = end === -1 ? rest : rest.slice(0, end);
			push("comment", text);
			rest = rest.slice(text.length);
			continue;
		}
		if (rest.startsWith("/*")) {
			const end = rest.indexOf("*/");
			const text = end === -1 ? rest : rest.slice(0, end + 2);
			push("comment", text);
			rest = rest.slice(text.length);
			continue;
		}

		const quote = rest[0];
		if (quote === '"' || quote === "'" || quote === "`") {
			let index = 1;
			while (index < rest.length && rest[index] !== quote) {
				if (rest[index] === "\\") index += 1;
				index += 1;
			}
			const text = rest.slice(0, Math.min(rest.length, index + 1));
			push("string", text);
			rest = rest.slice(text.length);
			continue;
		}

		const number = NUMBER.exec(rest);
		if (number) {
			push("number", number[0]);
			rest = rest.slice(number[0].length);
			continue;
		}

		const identifier = IDENTIFIER.exec(rest);
		if (identifier) {
			const word = identifier[0];
			const after = rest.slice(word.length);
			let kind: CodeTokenKind = "plain";
			const previous = state.previous;
			if (
				previous?.kind === "punctuation" &&
				(previous.text === "<" || previous.text === "</")
			) {
				kind = "tag";
				state.inTag = true;
			} else if (state.inTag && /^\s*=/.test(after)) kind = "attribute";
			else if (KEYWORDS.has(word)) kind = "keyword";
			else if (/^[A-Z]/.test(word)) kind = "type";
			else if (after.startsWith("(")) kind = "function";
			push(kind, word);
			rest = after;
			continue;
		}

		if (rest.startsWith("</") || rest.startsWith("/>")) {
			push("punctuation", rest.slice(0, 2));
			if (rest.startsWith("/>")) state.inTag = false;
			rest = rest.slice(2);
			continue;
		}
		const symbol = rest[0] ?? "";
		if (symbol === ">") state.inTag = false;
		push("punctuation", symbol);
		rest = rest.slice(1);
	}

	return tokens;
}
