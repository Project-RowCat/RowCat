/**
 * @vitest-environment jsdom
 */
import { beforeAll, describe, expect, it } from "vitest";
import { waitForTokenizer } from "#/test/monaco-dom.ts";
import {
	applyRuntimeMonacoTheme,
	configureRuntimeMonaco,
	RUNTIME_THEME,
	TS_LANGUAGE_ID,
} from "./monaco-setup.ts";
import {
	RUNTIME_CHROME_DARK,
	RUNTIME_CHROME_LIGHT,
	RUNTIME_SYNTAX_DARK,
	RUNTIME_SYNTAX_LIGHT,
	type RuntimeSyntaxPalette,
	runtimeMonacoTheme,
} from "./monaco-theme.ts";
import { RUNTIME_SEMANTIC_TOKEN_TYPES } from "./semantic-tokens.ts";

/** WCAG relative luminance. A minimal helper, enough to check contrast as numbers. */
function luminance(hex: string): number {
	const channel = (from: number) => {
		const value = Number.parseInt(hex.slice(from, from + 2), 16) / 255;
		return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

function contrast(a: string, b: string): number {
	const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [
		number,
		number,
	];
	return (high + 0.05) / (low + 0.05);
}

/**
 * Palettes must be readable. That the two appearances are not inversions of each other is verified
 * only through these numbers. An inverted palette makes contrast hold on one side only, and that
 * failure shows up only for people using that appearance.
 */
describe("palette", () => {
	const named = (palette: RuntimeSyntaxPalette) =>
		Object.entries(palette).map(([name, value]) => [name, value] as const);

	it.each(
		named(RUNTIME_SYNTAX_LIGHT),
	)("%s in the light theme passes body contrast", (_name, color) => {
		expect(contrast(color, RUNTIME_CHROME_LIGHT.background)).toBeGreaterThan(
			4.5,
		);
	});

	it.each(
		named(RUNTIME_SYNTAX_DARK),
	)("%s in the dark theme passes body contrast", (_name, color) => {
		expect(contrast(color, RUNTIME_CHROME_DARK.background)).toBeGreaterThan(
			4.5,
		);
	});

	/**
	 * Colors must be distinct. Two identical values amount to deleting one rule, and the palette then
	 * claims to be wider than it really is.
	 */
	it.each([
		["light", RUNTIME_SYNTAX_LIGHT],
		["dark", RUNTIME_SYNTAX_DARK],
	])("the %s theme's semantic colors don't collide", (_label, palette) => {
		const hues = [
			palette.keyword,
			palette.type,
			palette.function,
			palette.parameter,
			palette.property,
			palette.string,
			palette.number,
			palette.regexp,
			palette.comment,
		];
		expect(new Set(hues).size).toBe(hues.length);
	});

	/**
	 * Six to nine colors is the cap. Coloring every punctuation mark makes the eye follow color
	 * instead of text.
	 */
	it("no more than nine colors", () => {
		const hues = new Set(
			Object.entries(RUNTIME_SYNTAX_LIGHT)
				.filter(([name]) => name !== "foreground" && name !== "punctuation")
				.map(([, value]) => value),
		);
		expect(hues.size).toBeLessThanOrEqual(9);
	});
});

/** Every lexical rule name this palette covers. The list holds names, not values. */
const LEXICAL_RULES = [
	"identifier",
	"delimiter",
	"keyword",
	"type.identifier",
	"tag",
	"attribute.name",
	"attribute.value",
	"string",
	"string.escape",
	"number",
	"regexp",
	"comment",
] as const;

describe("theme data", () => {
	it("no theme is built without rules", () => {
		for (const dark of [false, true])
			for (const chrome of [undefined, { background: "#123456" }]) {
				const theme = runtimeMonacoTheme({ dark, chrome });
				expect(theme.rules.length).toBeGreaterThan(10);
				expect(Object.keys(theme.colors).length).toBeGreaterThan(5);
			}
	});

	/**
	 * Pins the rule names as values. Counting alone would let `keyword` disappear and another name
	 * take its place while the test still passed. The symptom of that state is that keywords alone get
	 * the foreground color, which is hard to notice by eye.
	 */
	it.each([
		["light", false],
		["dark", true],
	])("the %s theme has both lexical and semantic rules", (_label, dark) => {
		const names = new Set(
			runtimeMonacoTheme({ dark }).rules.map((rule) => rule.token),
		);
		for (const token of LEXICAL_RULES) expect(names).toContain(token);
		for (const token of RUNTIME_SEMANTIC_TOKEN_TYPES)
			expect(names).toContain(token);
	});

	/**
	 * Both appearances must have the same rule set. If one side has a rule the other lacks, the
	 * missing tokens fall back to Monaco's default theme on that side (the 2015-era blue and maroon).
	 * That mismatch is visible only to people using that appearance.
	 */
	it("both appearances paint the same names the same number of times", () => {
		const names = (dark: boolean) =>
			runtimeMonacoTheme({ dark }).rules.map((rule) => rule.token);
		expect(names(true)).toEqual(names(false));
		for (const dark of [false, true])
			for (const rule of runtimeMonacoTheme({ dark }).rules)
				expect(rule.foreground, `${rule.token} has no color`).toMatch(
					/^#[0-9a-f]{6}$/,
				);
	});

	/** Swapping only the surface keeps the rule count. This is the regression this slice fixes. */
	it("the rule count is the same across surfaces", () => {
		const plain = runtimeMonacoTheme({ dark: true });
		const tinted = runtimeMonacoTheme({
			dark: true,
			chrome: { background: "#101014", foreground: "#fafafa" },
		});
		expect(tinted.rules).toEqual(plain.rules);
		expect(tinted.colors["editor.background"]).toBe("#101014");
	});

	/**
	 * The semantic-token rules contain only names that actually arrive. The standard distribution also
	 * looks up semantic token styles in this rule table (getTokenStyleMetadata matches [type,
	 * ...modifiers].join('.')). A name that never arrives does nothing while making the palette look
	 * wider.
	 */
	it("semantic rule names are within the legend", () => {
		const lexical = new Set<string>(LEXICAL_RULES);
		const legend = new Set<string>(RUNTIME_SEMANTIC_TOKEN_TYPES);
		for (const rule of runtimeMonacoTheme({ dark: false }).rules)
			expect(
				lexical.has(rule.token) || legend.has(rule.token),
				`${rule.token} is in neither the vocabulary nor the legend`,
			).toBe(true);
	});
});

/**
 * Checks whether the rule names line up with the scopes that actually arrive, measured with a real
 * tokenizer.
 *
 * The rest of this file checks theme data. Through that window, two defects are invisible: dead
 * rules (a line paints a name that never arrives) and uncovered scopes (a name that arrives but
 * that no rule catches). The first makes the palette look wider than it is; the second leaves those
 * characters in Monaco's default color.
 *
 * Monaco matches by dot-separated prefix (StandaloneTheme's token theme is built that way), so a
 * keyword rule catches both keyword.ts and keyword.other.ts. The comparison below uses the same
 * rule.
 */
describe("rules and real tokens", () => {
	/** The source where every lexical rule of this repo appears at least once. */
	const CORPUS = [
		"// comment",
		"/** doc */",
		"interface Character { name: string }",
		"const count = 12;",
		'const text = "hi\\nthere";',
		"const matcher = /ab+c/gi;",
		"function render(user: Character) { return user.name; }",
		"const view = (",
		'\t<Stack gap={12} title="hi">',
		"\t\t<Text>{count}</Text>",
		"\t</Stack>",
		");",
	].join("\n");

	let emitted: Set<string>;

	beforeAll(async () => {
		const monaco = configureRuntimeMonaco();
		await waitForTokenizer(
			(text, language) => monaco.editor.tokenize(text, language),
			TS_LANGUAGE_ID,
		);
		emitted = new Set(
			monaco.editor
				.tokenize(CORPUS, TS_LANGUAGE_ID)
				.flat()
				.map((token) => token.type)
				.filter(Boolean),
		);
	}, 60_000);

	/** Prefix matching, the same rule Monaco uses. */
	const covers = (rule: string, scope: string) =>
		scope === rule || scope.startsWith(`${rule}.`);

	it("no dead lexical rules", () => {
		for (const rule of LEXICAL_RULES)
			expect(
				[...emitted].some((scope) => covers(rule, scope)),
				`no scope arrives for the ${rule} rule`,
			).toBe(true);
	});

	/**
	 * No arriving range goes uncovered. string.invalid counts too: while typing, every string is
	 * briefly unterminated, and the string rule catches it by prefix.
	 */
	it("no scope goes unpainted", () => {
		const rules = runtimeMonacoTheme({ dark: false }).rules.map(
			(rule) => rule.token,
		);
		for (const scope of emitted)
			expect(
				rules.some((rule) => covers(rule, scope)),
				`no rule catches ${scope}`,
			).toBe(true);
	});

	/**
	 * Checks that this source splits into several colors rather than collapsing into one. The emitted
	 * scopes are mapped to colors and counted, so a palette that collapsed would fail.
	 */
	it("this source splits into several colors", () => {
		const theme = runtimeMonacoTheme({ dark: false });
		const colors = new Set(
			[...emitted].map(
				(scope) =>
					[...theme.rules].reverse().find((rule) => covers(rule.token, scope))
						?.foreground,
			),
		);
		colors.delete(undefined);
		expect(colors.size).toBeGreaterThanOrEqual(7);
	});
});

/**
 * Switching appearance must neither recreate the model nor lose colors. Replacing the model would
 * lose the cursor, undo history, diagnostics, and scroll position. That regression is visible on
 * screen, but in tests only this identity comparison catches it.
 */
describe("appearance switch", () => {
	let monaco: ReturnType<typeof configureRuntimeMonaco>;

	beforeAll(async () => {
		monaco = configureRuntimeMonaco();
		await waitForTokenizer(
			(text, language) => monaco.editor.tokenize(text, language),
			TS_LANGUAGE_ID,
		);
	}, 60_000);

	it("light → dark → light keeps the model and grammar", () => {
		const uri = monaco.Uri.parse("file:///theme-switch/src/main.tsx");
		const model =
			monaco.editor.getModel(uri) ??
			monaco.editor.createModel(
				"const view = <Text>hi</Text>;",
				TS_LANGUAGE_ID,
				uri,
			);
		const rich = () =>
			new Set(
				monaco.editor
					.tokenize(model.getValue(), TS_LANGUAGE_ID)
					.flat()
					.map((token) => token.type)
					.filter(Boolean),
			).size;

		const before = rich();
		expect(before).toBeGreaterThan(3);

		for (const dark of [true, false, true]) {
			applyRuntimeMonacoTheme(dark, null);
			expect(monaco.editor.getModel(uri)).toBe(model);
			expect(model.isDisposed()).toBe(false);
			expect(rich()).toBe(before);
		}

		/** The last applied theme name is really ours; it did not fall back to a built-in theme. */
		expect(RUNTIME_THEME.dark).toBe("rowcat-dark");
		model.dispose();
	});
});
