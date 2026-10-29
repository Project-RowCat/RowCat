/**
 * @vitest-environment jsdom
 */
import { language as typescriptLanguage } from "monaco-editor/languages/definitions/typescript/typescript";
import { describe, expect, it } from "vitest";
import { type MonarchLanguage, withJsx } from "./tsx-grammar.ts";

/**
 * Regression for the extension function itself. It checks the object the function produces, not the
 * tokens. The sibling runtime-tokenization.test.ts measures colors with the real tokenizer. This
 * file covers what the token view cannot show:
 * - The official grammar object is left unchanged. It is a module singleton, so modifying it in
 *   place makes the result depend on call order.
 * - Calling twice gives the same result. StrictMode, HMR and test order really do call it twice.
 * - The keyword and operator lists are not copies. They must be the official object's own, which
 *   only matters when TypeScript adds a keyword.
 *
 * None of these has a visible symptom: the first changes colors with test order, and the third only
 * shows on the day TypeScript adds a keyword.
 */

const base = () => typescriptLanguage as unknown as MonarchLanguage;

describe("does not modify the official grammar", () => {
	/**
	 * The object exported by monaco-editor/languages/definitions/typescript/typescript is a module
	 * singleton. Changing it in place, for example with tokenizer.common.unshift(...), stacks the
	 * rules again on every call in the same process. That raises no error.
	 */
	it("the original's state list is unchanged", () => {
		const before = structuredClone(base().tokenizer);
		withJsx(base());
		expect(base().tokenizer).toEqual(before);
	});

	it("no JSX state appears in the original", () => {
		withJsx(base());
		for (const state of ["jsxText", "jsxAttributes", "jsxExpression"])
			expect(Object.keys(base().tokenizer)).not.toContain(state);
	});

	it("it's a copy, not the same object", () => {
		const extended = withJsx(base());
		expect(extended).not.toBe(base());
		expect(extended.tokenizer).not.toBe(base().tokenizer);
		expect(extended.tokenizer.common).not.toBe(base().tokenizer.common);
	});

	/** Calling twice gives the same grammar, so rules do not accumulate. */
	it("two calls give the same grammar", () => {
		const first = withJsx(base());
		const second = withJsx(base());
		expect(second.tokenizer.common?.length).toBe(
			first.tokenizer.common?.length,
		);
		expect(JSON.stringify(second.tokenizer)).toBe(
			JSON.stringify(first.tokenizer),
		);
	});
});

describe("adds only what it adds", () => {
	/**
	 * The lists are not copied. Keywords, operators and symbols are referenced from the official
	 * object, so upgrading Monaco picks up a new TypeScript keyword without changes here.
	 */
	it("keywords, operators and symbols are the official object's", () => {
		const extended = withJsx(base()) as Record<string, unknown>;
		for (const key of ["keywords", "operators", "symbols", "escapes", "digits"])
			expect(extended[key]).toBe((base() as Record<string, unknown>)[key]);
	});

	it("adds four states and carries the rest over", () => {
		const extended = withJsx(base());
		const added = Object.keys(extended.tokenizer).filter(
			(state) => !(state in base().tokenizer),
		);
		expect(added.sort()).toEqual([
			"jsxAttributes",
			"jsxExpression",
			"jsxGeneric",
			"jsxText",
		]);
		for (const state of Object.keys(base().tokenizer))
			if (state !== "common")
				expect(extended.tokenizer[state]).toEqual(base().tokenizer[state]);
	});

	/**
	 * The entry goes at the front of common and the original rules stay whole behind it. If the order
	 * were reversed, the official identifier rule would take Text in <Text first and never reach the
	 * JSX rule.
	 */
	it("entry rules come first and the original stays after", () => {
		const extended = withJsx(base());
		const original = base().tokenizer.common ?? [];
		const common = extended.tokenizer.common ?? [];
		expect(common.length).toBe(original.length + 5);
		expect(common.slice(-original.length)).toEqual(original);
	});

	/**
	 * Expression state is TypeScript again inside { … }. It includes common by reference, not by copy.
	 */
	it("the expression state includes common", () => {
		expect(withJsx(base()).tokenizer.jsxExpression).toContainEqual({
			include: "common",
		});
	});
});
