import type * as monaco from "monaco-editor/editor/editor.api";

/**
 * Builds one editor theme. Color rules and editor surface come from the same function, so the rules
 * cannot be left out when only the background changes.
 *
 * An earlier version set base vs/vs-dark with no rules, so Monaco used its own default colors (VS
 * Code 2015 blue, maroon, red). Redefining the theme with colors but rules: [] silently removes all
 * syntax colors and raises no error.
 *
 * Lexical and semantic token names share one rule table. Monaco matches [type, ...modifiers] joined
 * with dots, by dot-separated prefix, so keyword also covers keyword.ts, and type also covers
 * type.identifier on purpose.
 *
 * Only nine named colors exist: keyword, type, function, property, parameter, string, number,
 * regexp, comment. Identifiers, variables and punctuation use the foreground color, because
 * coloring each punctuation mark makes readers follow color instead of text.
 *
 * Light and dark palettes are authored separately, not inverted. Light uses the 700 range (4.5:1 or
 * more on white); dark uses the 300 range (7:1 or more on black). The test
 * runtime-monaco-theme.test.ts checks these contrast values.
 */

export interface RuntimeSyntaxPalette {
	foreground: string;
	punctuation: string;
	keyword: string;
	type: string;
	function: string;
	parameter: string;
	property: string;
	string: string;
	number: string;
	regexp: string;
	comment: string;
}

/**
 * Light palette for a white background. Every value is in the 700 range, which clears the 4.5:1
 * body-text contrast baseline.
 */
export const RUNTIME_SYNTAX_LIGHT: RuntimeSyntaxPalette = {
	foreground: "#18181b",
	punctuation: "#52525b",
	keyword: "#6d28d9",
	type: "#0e7490",
	function: "#1d4ed8",
	parameter: "#4338ca",
	property: "#a21caf",
	string: "#15803d",
	number: "#b45309",
	regexp: "#be123c",
	comment: "#64748b",
};

/**
 * Dark palette for a black background. Every value is in the 300 range, so all are bright. Comments
 * are one step dimmer but still above 4.5:1.
 */
export const RUNTIME_SYNTAX_DARK: RuntimeSyntaxPalette = {
	foreground: "#e4e4e7",
	punctuation: "#a1a1aa",
	keyword: "#c4b5fd",
	type: "#67e8f9",
	function: "#93c5fd",
	parameter: "#a5b4fc",
	property: "#f0abfc",
	string: "#86efac",
	number: "#fcd34d",
	regexp: "#fda4af",
	comment: "#94a3b8",
};

/**
 * Editor surface colors: the container, not syntax colors. They are read from the app's real
 * background, since some deployments override it with an account theme. If the background cannot be
 * read, defaults are used. A slightly wrong surface is much less severe than losing all syntax
 * colors.
 */
export interface RuntimeEditorChrome {
	background: string;
	foreground: string;
	/** A faint layer drawn over the background (the current line, inactive selections). */
	surface: string;
	border: string;
	selection: string;
	cursor: string;
	muted: string;
}

export const RUNTIME_CHROME_LIGHT: RuntimeEditorChrome = {
	background: "#ffffff",
	foreground: "#18181b",
	surface: "#f4f4f5",
	border: "#e4e4e7",
	selection: "#c7d2fe",
	cursor: "#6d28d9",
	muted: "#71717b",
};

export const RUNTIME_CHROME_DARK: RuntimeEditorChrome = {
	background: "#09090b",
	foreground: "#e4e4e7",
	surface: "#18181b",
	border: "#27272a",
	selection: "#3730a3",
	cursor: "#c4b5fd",
	muted: "#a1a1aa",
};

/**
 * Lexical token rules. The names were measured, not guessed: they are the ranges that
 * monaco.editor.tokenize() actually returns. The 'rules and real tokens' test in
 * runtime-monaco-theme.test.ts re-measures them with the real tokenizer and compares both ways. A
 * listed name that never occurs (dead rule) and an occurring name that is not listed (unstyled
 * range) both fail there.
 */
function lexicalRules(
	palette: RuntimeSyntaxPalette,
): monaco.editor.ITokenThemeRule[] {
	return [
		{ token: "identifier", foreground: palette.foreground },
		{ token: "delimiter", foreground: palette.punctuation },
		{ token: "keyword", foreground: palette.keyword },
		{ token: "type.identifier", foreground: palette.type },
		/** JSX tag names. Components are read like type names, so they take the type color. */
		{ token: "tag", foreground: palette.type },
		{ token: "attribute.name", foreground: palette.property },
		{ token: "attribute.value", foreground: palette.string },
		{ token: "string", foreground: palette.string },
		/**
		 * Escapes are constants inside a string. Unterminated strings (string.invalid) get no rule on
		 * purpose: prefix matching folds them into string, which is correct, since every string is
		 * briefly unterminated while typing.
		 */
		{ token: "string.escape", foreground: palette.number },
		{ token: "number", foreground: palette.number },
		{ token: "regexp", foreground: palette.regexp },
		{ token: "comment", foreground: palette.comment },
	];
}

/**
 * Semantic token rules: the twelve names the TypeScript service actually emits. The source is
 * TokenType in classifier2020 (runtime-semantic-tokens.ts holds the same vocabulary). A name not
 * listed there never arrives in any request, and a rule for it would do nothing while making the
 * palette look wider.
 *
 * variable is pinned to the foreground color on purpose. Monaco's default theme gives that name
 * blue (74B0DF in vs-dark), so leaving it unset would paint every local variable blue.
 */
function semanticRules(
	palette: RuntimeSyntaxPalette,
): monaco.editor.ITokenThemeRule[] {
	return [
		{ token: "class", foreground: palette.type },
		{ token: "interface", foreground: palette.type },
		{ token: "enum", foreground: palette.type },
		{ token: "namespace", foreground: palette.type },
		{ token: "typeParameter", foreground: palette.type },
		{ token: "type", foreground: palette.type },
		{ token: "function", foreground: palette.function },
		{ token: "member", foreground: palette.function },
		{ token: "property", foreground: palette.property },
		{ token: "enumMember", foreground: palette.number },
		{ token: "parameter", foreground: palette.parameter },
		{ token: "variable", foreground: palette.foreground },
	];
}

export interface RuntimeMonacoThemeInput {
	dark: boolean;
	/** Surface read from the current screen. If absent, this appearance's defaults are used. */
	chrome?: Partial<RuntimeEditorChrome>;
}

/**
 * Returns one theme object with lexical, semantic and surface rules together.
 *
 * inherit: true keeps the colors Monaco defines only in its own default theme (bracket pair colors,
 * error squiggles, widget shadows). Our rules come after, so they win on overlapping names.
 */
export function runtimeMonacoTheme({
	dark,
	chrome,
}: RuntimeMonacoThemeInput): monaco.editor.IStandaloneThemeData {
	const palette = dark ? RUNTIME_SYNTAX_DARK : RUNTIME_SYNTAX_LIGHT;
	const surface = {
		...(dark ? RUNTIME_CHROME_DARK : RUNTIME_CHROME_LIGHT),
		...chrome,
	};

	return {
		base: dark ? "vs-dark" : "vs",
		inherit: true,
		rules: [...lexicalRules(palette), ...semanticRules(palette)],
		colors: {
			"editor.background": surface.background,
			"editor.foreground": surface.foreground,
			"editorLineNumber.foreground": surface.muted,
			"editorLineNumber.activeForeground": surface.foreground,
			"editor.lineHighlightBackground": surface.surface,
			"editor.selectionBackground": surface.selection,
			/**
			 * The inactive selection color also marks other occurrences of the same word, not just inactive
			 * selections. If it matched the active selection color, the cursor's side could not be told
			 * apart.
			 */
			"editor.inactiveSelectionBackground": surface.surface,
			"editor.selectionHighlightBackground": surface.surface,
			"editorCursor.foreground": surface.cursor,
			"editorIndentGuide.background1": surface.border,
			"editorIndentGuide.activeBackground1": surface.muted,
			"editorWhitespace.foreground": surface.border,
			"editorBracketMatch.background": surface.surface,
			"editorBracketMatch.border": surface.muted,
			"editorWidget.background": surface.background,
			"editorWidget.border": surface.border,
			"editorSuggestWidget.background": surface.background,
			"editorSuggestWidget.border": surface.border,
			"editorHoverWidget.background": surface.background,
			"editorHoverWidget.border": surface.border,
			"editorGutter.background": surface.background,
			"scrollbarSlider.background": `${surface.border}99`,
			"scrollbarSlider.hoverBackground": surface.border,
			"scrollbarSlider.activeBackground": surface.muted,
		},
	};
}
