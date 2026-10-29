import { classifyRuntimeAssetValue } from "@rowcat/runtime/asset";

/**
 * Single lexical scanner for `asset("…")` literals, shared by autocomplete, hover, and reference
 * counting. Separate regex copies would disagree on comments or templates, and the drift would show
 * only in the editor.
 *
 * This is not a security boundary. The publish-time allowlist pass
 * (`packages/runtime-compiler/remote-assets.ts`) walks the TypeScript AST and must not miss any
 * value sent out. Here a miss only means no autocomplete, so the scanner is conservative: a
 * position counts as a context only when the callee is `asset`, the string is its first argument,
 * and the literal is complete with no substitution. Aliases such as `import { asset as img }` are
 * not followed. Following them needs scope analysis, which means bundling the TypeScript compiler
 * (§30).
 *
 * Lexical state is tracked exactly (line and block comments, strings, templates, and `${…}` parts),
 * because a plain search for the text asset("` would match inside comments and strings. Regex
 * literals are a heuristic based on the preceding significant character. Misreading one loses only
 * that line's autocomplete.
 *
 * Known limit: an apostrophe in TSX text (`<Text>don't</Text>`) opens a string here. Quoted strings
 * end at the line break, so the error stays on that line and the scanner finds less, never more.
 * Reference counts therefore cover only names written directly. Dynamic names are the other half.
 */

interface ScannedLiteral {
	open: number;
	/**
	 * Start and end of the content inside the quotes. `end` is the position of the closing quote, or
	 * where the literal was cut off.
	 */
	start: number;
	end: number;
	text: string;
	dynamic: boolean;
	/**
	 * Whether the closing quote was reached. If not, scanning stopped at the end of the line or the
	 * file.
	 */
	terminated: boolean;
}

const isSpace = (char: string): boolean =>
	char === " " || char === "\t" || char === "\n" || char === "\r";

const isIdentifierChar = (char: string): boolean =>
	(char >= "a" && char <= "z") ||
	(char >= "A" && char <= "Z") ||
	(char >= "0" && char <= "9") ||
	char === "_" ||
	char === "$";

/**
 * Checks that the string is the first argument of `asset(`, by walking backward from the opening
 * quote. Requiring the parenthesis directly before it excludes later arguments (preceded by a
 * comma) and other calls such as `translate("x")`. The walk deliberately does not skip comments: a
 * comment between the parenthesis and the string is valid but never used, and a second rule for
 * reading comments backward would risk drifting from the forward scanner.
 */
function isAssetArgument(source: string, open: number): boolean {
	let at = open - 1;
	while (at >= 0 && isSpace(source[at] as string)) at -= 1;
	if (at < 0 || source[at] !== "(") return false;
	at -= 1;
	while (at >= 0 && isSpace(source[at] as string)) at -= 1;
	const nameEnd = at + 1;
	while (at >= 0 && isIdentifierChar(source[at] as string)) at -= 1;
	if (source.slice(at + 1, nameEnd) !== "asset") return false;
	/**
	 * `obj.asset("x")` is not a public form of this API, so a member call is excluded. The check is
	 * narrowed toward exclusion.
	 */
	return at < 0 || source[at] !== ".";
}

/**
 * Whether a regex literal can start here. This is a guess based on the previous significant
 * character. Without this split, the quote in `/"/` would open a string and the rest of that line
 * would be misread. Treating a division as a regex (as in `a / "b".length`) loses only that line's
 * autocomplete, which is the cheaper error.
 */
const REGEX_ALLOWED_BEFORE = "([{,;:=!?&|+-*%^~<>";

const regexAllowed = (significant: string): boolean =>
	significant === "" || REGEX_ALLOWED_BEFORE.includes(significant);

function endOfLine(source: string, from: number): number {
	const at = source.indexOf("\n", from);
	return at === -1 ? source.length : at;
}

/**
 * Skips a single- or double-quoted string, stopping at the end of the line. JavaScript quoted
 * strings cannot contain a raw newline, so an unclosed quote stays confined to its own line,
 * matching both the grammar and the scanner's promise.
 */
function skipQuoted(
	source: string,
	open: number,
	quote: string,
): { end: number; terminated: boolean } {
	let at = open + 1;
	while (at < source.length) {
		const char = source[at] as string;
		if (char === "\\") {
			at += 2;
			continue;
		}
		if (char === "\n") return { end: at, terminated: false };
		if (char === quote) return { end: at, terminated: true };
		at += 1;
	}
	return { end: source.length, terminated: false };
}

function skipRegex(source: string, open: number): number {
	let at = open + 1;
	let inClass = false;
	while (at < source.length) {
		const char = source[at] as string;
		if (char === "\\") {
			at += 2;
			continue;
		}
		if (char === "\n") return at;
		if (char === "[") inClass = true;
		else if (char === "]") inClass = false;
		else if (char === "/" && !inClass) return at + 1;
		at += 1;
	}
	return source.length;
}

/**
 * Scans one source and collects only the strings that are arguments of `asset()`. It walks
 * everything but keeps only those strings, because building an array of every literal per file
 * would cost on every keystroke in a large project.
 */
function scanAssetLiterals(source: string): ScannedLiteral[] {
	const found: ScannedLiteral[] = [];
	const length = source.length;
	/**
	 * Templates currently open. A template can open again inside a `${…}` substitution, so this is a
	 * stack.
	 */
	const templates: { open: number; dynamic: boolean; braces: number }[] = [];
	/**
	 * Brace depth inside the current substitution. At `0` with a template open, the scanner is reading
	 * the template body.
	 */
	let braces = 0;
	let significant = "";
	let at = 0;

	const push = (literal: ScannedLiteral): void => {
		if (isAssetArgument(source, literal.open)) found.push(literal);
	};

	while (at < length) {
		const template = templates[templates.length - 1];

		if (template !== undefined && braces === 0) {
			const char = source[at] as string;
			if (char === "\\") {
				at += 2;
				continue;
			}
			if (char === "$" && source[at + 1] === "{") {
				template.dynamic = true;
				braces = 1;
				at += 2;
				continue;
			}
			if (char === "`") {
				templates.pop();
				braces = template.braces;
				push({
					open: template.open,
					start: template.open + 1,
					end: at,
					text: source.slice(template.open + 1, at),
					dynamic: template.dynamic,
					terminated: true,
				});
				significant = "`";
				at += 1;
				continue;
			}
			at += 1;
			continue;
		}

		/* Plain code, including code inside `${…}` substitutions. */
		const char = source[at] as string;

		if (char === "/" && source[at + 1] === "/") {
			at = endOfLine(source, at);
			continue;
		}
		if (char === "/" && source[at + 1] === "*") {
			const close = source.indexOf("*/", at + 2);
			at = close === -1 ? length : close + 2;
			continue;
		}
		if (char === "/" && regexAllowed(significant)) {
			at = skipRegex(source, at);
			significant = "/";
			continue;
		}
		if (char === '"' || char === "'") {
			const { end, terminated } = skipQuoted(source, at, char);
			push({
				open: at,
				start: at + 1,
				end,
				text: source.slice(at + 1, end),
				dynamic: false,
				terminated,
			});
			significant = char;
			at = terminated ? end + 1 : end;
			continue;
		}
		if (char === "`") {
			templates.push({ open: at, dynamic: false, braces });
			braces = 0;
			at += 1;
			continue;
		}
		if (char === "{") {
			braces += 1;
			significant = char;
			at += 1;
			continue;
		}
		if (char === "}") {
			if (braces > 0) braces -= 1;
			significant = char;
			at += 1;
			continue;
		}
		if (!isSpace(char)) significant = char;
		at += 1;
	}

	/**
	 * A template left unclosed at end of file. The cursor there can still trigger autocomplete. It is
	 * pushed with `terminated: false`, so the caller confines the replacement range to that line.
	 */
	for (const template of templates)
		push({
			open: template.open,
			start: template.open + 1,
			end: length,
			text: source.slice(template.open + 1),
			dynamic: template.dynamic,
			terminated: false,
		});

	return found;
}

export interface RuntimeAssetLiteralContext {
	/** Range to replace, inside the quotes. */
	start: number;
	end: number;
	text: string;
}

/**
 * Returns the range to replace when the offset is inside an `asset("…")` string. This excludes
 * templates with substitutions, since a picked item would erase `${face}`.
 *
 * An unclosed literal is bounded at its line end, so a stray `asset(` cannot make the range cover
 * the rest of the file. Ranges spanning several lines are excluded: logical names cannot contain
 * newlines, and Monaco errors on multi-line completion ranges.
 */
export function runtimeAssetLiteralAt(
	source: string,
	offset: number,
): RuntimeAssetLiteralContext | null {
	for (const literal of scanAssetLiterals(source)) {
		if (literal.dynamic) continue;
		const end = literal.terminated
			? literal.end
			: Math.min(literal.end, endOfLine(source, offset));
		if (offset < literal.start || offset > end) continue;
		const text = source.slice(literal.start, end);
		if (text.includes("\n")) return null;
		return { start: literal.start, end, text };
	}
	return null;
}

/**
 * Which primitive receives this name: 'image', 'audio', or null when unknown. A known kind filters
 * autocomplete to that kind only, since the trusted resolver assembles no address for a mismatched
 * name and the slot would silently show a placeholder. It answers only when `asset(` directly
 * follows `source={` on an exact `Image` or `Audio` tag. The opening tag is found by a backward
 * walk that skips other props' expressions and strings. Aliases such as `import { Image as Img }`
 * are not followed, because that needs scope analysis. Every doubt returns null, which shows both
 * kinds: a longer list costs less than hiding the right name.
 */
export type RuntimeAssetConsumerKind = "image" | "audio";

const CONSUMER_TAGS: Readonly<Record<string, RuntimeAssetConsumerKind>> = {
	Image: "image",
	Audio: "audio",
};

/** Gives up searching for an opening tag longer than this. The code runs on every keystroke. */
const CONSUMER_SCAN_LIMIT = 4_000;

export function runtimeAssetConsumerAt(
	source: string,
	literalStart: number,
): RuntimeAssetConsumerKind | null {
	const skipSpaceBack = (from: number): number => {
		let at = from;
		while (at >= 0 && isSpace(source[at] as string)) at -= 1;
		return at;
	};

	/** The backward chain from the opening quote: `(`, then `asset`, then `{`, `=`, and `source`. */
	let at = skipSpaceBack(literalStart - 2);
	if (source[at] !== "(") return null;
	at = skipSpaceBack(at - 1);
	const callEnd = at + 1;
	while (at >= 0 && isIdentifierChar(source[at] as string)) at -= 1;
	if (source.slice(at + 1, callEnd) !== "asset") return null;
	at = skipSpaceBack(at);
	if (source[at] !== "{") return null;
	at = skipSpaceBack(at - 1);
	if (source[at] !== "=") return null;
	at = skipSpaceBack(at - 1);
	const propEnd = at + 1;
	while (at >= 0 && isIdentifierChar(source[at] as string)) at -= 1;
	if (source.slice(at + 1, propEnd) !== "source") return null;

	const floor = Math.max(0, at - CONSUMER_SCAN_LIMIT);
	let depth = 0;
	while (at >= floor) {
		const char = source[at] as string;
		if (char === '"' || char === "'" || char === "`") {
			/** Skips a whole string so brackets inside it do not disturb the depth count. */
			const open = source.lastIndexOf(char, at - 1);
			if (open < floor) return null;
			at = open - 1;
			continue;
		}
		if (char === "}") depth += 1;
		else if (char === "{") {
			depth -= 1;
			/**
			 * A depth below zero means the position is inside an enclosing expression, not in the tag's
			 * attribute slot, so the result is null.
			 */
			if (depth < 0) return null;
		} else if (depth === 0 && char === ">") return null;
		else if (depth === 0 && char === "<") {
			let end = at + 1;
			while (end < source.length && isIdentifierChar(source[end] as string))
				end += 1;
			return CONSUMER_TAGS[source.slice(at + 1, end)] ?? null;
		}
		at -= 1;
	}
	return null;
}

export interface RuntimeAssetReference {
	/** Logical name. Remote addresses and invalid values never reach here. */
	path: string;
	start: number;
	end: number;
}

/**
 * Logical names written directly in one source. Validity is decided only by
 * `classifyRuntimeAssetValue` from the language contract. A second name check here would let the
 * editor accept names that publishing rejects, or the reverse. Remote URLs (`https://…`) are
 * excluded because this layer only answers about managed images, and author-supplied addresses
 * follow a different authorization model (§8, §23).
 */
export function collectRuntimeAssetReferences(
	source: string,
): RuntimeAssetReference[] {
	const references: RuntimeAssetReference[] = [];
	for (const literal of scanAssetLiterals(source)) {
		if (literal.dynamic) continue;
		const target = classifyRuntimeAssetValue(literal.text);
		if (target === null || target.kind !== "logical") continue;
		references.push({
			path: target.path,
			start: literal.start,
			end: literal.end,
		});
	}
	return references;
}

export function runtimeAssetReferenceAt(
	source: string,
	offset: number,
): RuntimeAssetReference | null {
	for (const reference of collectRuntimeAssetReferences(source))
		if (offset >= reference.start && offset <= reference.end) return reference;
	return null;
}

/** Where one name is written directly. Line and column are 1-based. */
export interface RuntimeAssetReferenceSite {
	file: string;
	line: number;
	column: number;
}

/**
 * What the screen shows before a rename or removal: where the name is written, and what cannot be
 * known.
 */
export interface RuntimeAssetReferenceReport {
	/**
	 * Places where the name is written directly, in file-path order and top to bottom within each
	 * file.
	 */
	sites: RuntimeAssetReferenceSite[];
	/**
	 * Count of assembled names, such as `asset(`characters/${who}/smile`)`. Each is a place whose name
	 * cannot be known. Only the call's existence can be counted; what it points to requires running
	 * the code. So this number means 'places that cannot be checked', not 'places using this name',
	 * and the UI says so. Calls through an alias or constant (`asset(NAME)`) are not counted, because
	 * their argument is not a string literal at all.
	 */
	assembled: number;
}

/**
 * Finds where a name is written directly in the project. Rename and remove use this to preview
 * their effect.
 *
 * It uses the same scan as autocomplete and hover (`scanAssetLiterals`). A second regex would miss
 * template interiors or count comment examples, so the screen would report a different number than
 * autocomplete does.
 *
 * This function never edits source; it only returns positions. Automatic replacement would be
 * unsafe, since aliased, constant, and assembled uses are invisible here.
 */
export function findRuntimeAssetReferences(
	files: readonly { path: string; content: string }[],
	path: string,
): RuntimeAssetReferenceReport {
	const sites: RuntimeAssetReferenceSite[] = [];
	let assembled = 0;
	const ordered = [...files].sort((left, right) =>
		left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
	);
	for (const file of ordered) {
		for (const literal of scanAssetLiterals(file.content)) {
			if (literal.dynamic) {
				assembled += 1;
				continue;
			}
			const target = classifyRuntimeAssetValue(literal.text);
			if (target === null || target.kind !== "logical") continue;
			if (target.path !== path) continue;
			sites.push({
				file: file.path,
				...positionOf(file.content, literal.start),
			});
		}
	}
	return { sites, assembled };
}

/**
 * Converts an offset to a 1-based line and column, matching editor coordinates. CRLF counts as one
 * line break.
 */
function positionOf(
	source: string,
	offset: number,
): { line: number; column: number } {
	let line = 1;
	let lineStart = 0;
	for (let at = 0; at < offset; at += 1)
		if (source[at] === "\n") {
			line += 1;
			lineStart = at + 1;
		}
	return { line, column: offset - lineStart + 1 };
}

/**
 * Count of places where the name is written directly. This is not an upper bound: assembled names
 * may add uses that are neither counted nor countable. Presenting it as 'used in exactly N places'
 * would be false (§35), so the copy always says 'written directly'.
 */
export function countRuntimeAssetReferences(
	files: readonly { content: string }[],
	path: string,
): number {
	let total = 0;
	for (const file of files)
		for (const reference of collectRuntimeAssetReferences(file.content))
			if (reference.path === path) total += 1;
	return total;
}
