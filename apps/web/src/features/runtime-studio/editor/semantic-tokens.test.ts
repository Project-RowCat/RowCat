import { describe, expect, it, vi } from "vitest";
import {
	decodeSemanticClassification,
	encodeSemanticTokens,
	provideRuntimeSemanticTokens,
	RUNTIME_SEMANTIC_FORMAT,
	RUNTIME_SEMANTIC_TOKEN_MODIFIERS,
	RUNTIME_SEMANTIC_TOKEN_TYPES,
	type RuntimeSemanticModel,
} from "./semantic-tokens.ts";

const classify = (typeIndex: number, modifiers = 0) =>
	((typeIndex + 1) << 8) | modifiers;

describe("decoding semantic classification", () => {
	it("the legend order matches TypeScript's", () => {
		expect(RUNTIME_SEMANTIC_TOKEN_TYPES[0]).toBe("class");
		expect(RUNTIME_SEMANTIC_TOKEN_TYPES[6]).toBe("parameter");
		expect(RUNTIME_SEMANTIC_TOKEN_TYPES[9]).toBe("property");
		expect(RUNTIME_SEMANTIC_TOKEN_TYPES[10]).toBe("function");
		expect(RUNTIME_SEMANTIC_TOKEN_MODIFIERS[0]).toBe("declaration");
		expect(RUNTIME_SEMANTIC_TOKEN_MODIFIERS[4]).toBe("defaultLibrary");
	});

	it("requires the `2020` format", () => {
		/**
		 * The default format, 'original', is a different encoding. Under it, the decoding below would
		 * give wrong answers for every token, so the format is pinned to 2020.
		 */
		expect(RUNTIME_SEMANTIC_FORMAT).toBe("2020");
	});

	it("splits type and modifiers", () => {
		expect(decodeSemanticClassification(classify(10, 0b101001))).toEqual({
			typeIndex: 10,
			modifiers: 0b101001,
		});
	});

	/**
	 * Checks every legend position. Measuring only one would reveal an off-by-one shift only there.
	 */
	it.each(
		RUNTIME_SEMANTIC_TOKEN_TYPES.map((name, index) => [name, index]),
	)("%s comes back from position %i", (name, index) => {
		const decoded = decodeSemanticClassification(classify(index as number));
		expect(decoded?.typeIndex).toBe(index);
		expect(RUNTIME_SEMANTIC_TOKEN_TYPES[decoded?.typeIndex ?? -1]).toBe(name);
	});

	/**
	 * Each modifier is one bit position, tested alone. A wrong mask turns neighboring bits on or off,
	 * and setting several bits at once would hide that error by cancelling it out.
	 */
	it.each(
		RUNTIME_SEMANTIC_TOKEN_MODIFIERS.map((name, bit) => [name, bit]),
	)("%s rides on bit %i as is", (_name, bit) => {
		const modifiers = 1 << (bit as number);
		expect(decodeSemanticClassification(classify(0, modifiers))).toEqual({
			typeIndex: 0,
			modifiers,
		});
	});

	it("turning on every modifier does not shift the type", () => {
		const all = (1 << RUNTIME_SEMANTIC_TOKEN_MODIFIERS.length) - 1;
		expect(decodeSemanticClassification(classify(11, all))).toEqual({
			typeIndex: 11,
			modifiers: all,
		});
	});

	/**
	 * Omitting `+ 1` shifts every name by one: functions get enum-member colors and properties get
	 * variable colors, while the screen still looks plausible.
	 */
	it.each([
		["0", 0],
		["negative", -1],
		["large negative", -4096],
		["fraction", 1.5],
		["NaN", Number.NaN],
		["infinity", Number.POSITIVE_INFINITY],
		["negative infinity", Number.NEGATIVE_INFINITY],
	])("%s is unclassified, not a class", (_label, value) => {
		expect(decodeSemanticClassification(value)).toBeNull();
	});

	/**
	 * A value with modifiers but no type is not a classification. Because of the +1, type 0 is encoded
	 * as 1 << 8.
	 */
	it("a value with only modifiers is not a classification", () => {
		expect(decodeSemanticClassification(0b101001)).toBeNull();
	});

	it.each([
		["just above", RUNTIME_SEMANTIC_TOKEN_TYPES.length],
		["far above", 99],
	])("a type outside the legend (%s) is dropped", (_label, index) => {
		expect(decodeSemanticClassification(classify(index))).toBeNull();
	});
});

describe("delta encoding", () => {
	const positionAt = (offset: number) => ({
		line: Math.floor(offset / 40),
		character: offset % 40,
	});

	it("the same line writes a character delta, a new line writes a line delta", () => {
		const data = encodeSemanticTokens(
			[2, 4, classify(0), 10, 3, classify(10), 44, 5, classify(9)],
			positionAt,
		);
		expect(data).toEqual([
			0, 2, 4, 0, 0,
			//
			0, 8, 3, 10, 0,
			//
			1, 4, 5, 9, 0,
		]);
	});

	it("skips unclassified ranges and zero lengths", () => {
		expect(
			encodeSemanticTokens(
				[0, 3, 0, 5, 0, classify(1), 8, 2, classify(2)],
				positionAt,
			),
		).toEqual([0, 8, 2, 2, 0]);
	});

	/**
	 * Monaco's encoding has no room for a token spanning lines, since its length counts characters
	 * within one line.
	 */
	it("drops ranges that cross lines", () => {
		expect(encodeSemanticTokens([38, 6, classify(5)], positionAt)).toEqual([]);
	});

	/** Assuming the order would let one out-of-order day paint the whole screen incorrectly. */
	it.each([
		["on the same line", [10, 2, classify(0), 4, 2, classify(0)]],
		["line going back", [44, 2, classify(0), 4, 2, classify(0)]],
	])("drops ranges going backward: %s", (_label, spans) => {
		expect(encodeSemanticTokens(spans as number[], positionAt).length).toBe(5);
	});

	/** A trailing partial triple is ignored, not thrown. */
	it.each([
		["only two numbers", [8, 2]],
		["four numbers", [8, 2, classify(1), 999]],
		["empty array", []],
	])("does not throw on an unterminated tail (%s)", (_label, spans) => {
		expect(() =>
			encodeSemanticTokens(spans as number[], positionAt),
		).not.toThrow();
	});

	it("also skips ranges with negative length", () => {
		expect(encodeSemanticTokens([8, -2, classify(1)], positionAt)).toEqual([]);
	});
});

describe("provider", () => {
	const model = (disposed = false): RuntimeSemanticModel => ({
		uri: { toString: () => "file:///p/__studio__/s1/src/main.tsx" },
		getOffsetAt: ({ lineNumber, column }) => (lineNumber - 1) * 40 + column - 1,
		getPositionAt: (offset) => ({
			lineNumber: Math.floor(offset / 40) + 1,
			column: (offset % 40) + 1,
		}),
		isDisposed: () => disposed,
	});

	const range = {
		startLineNumber: 1,
		startColumn: 1,
		endLineNumber: 2,
		endColumn: 1,
	};

	it("asks for exactly the span the worker saw", async () => {
		const getEncodedSemanticClassifications = vi
			.fn()
			.mockResolvedValue([2, 4, classify(0)]);
		const result = await provideRuntimeSemanticTokens(
			model(),
			range,
			async () => ({
				getEncodedSemanticClassifications,
			}),
		);

		expect(getEncodedSemanticClassifications).toHaveBeenCalledWith(
			"file:///p/__studio__/s1/src/main.tsx",
			0,
			40,
		);
		expect([...(result?.data ?? [])]).toEqual([0, 2, 4, 0, 0]);
	});

	/**
	 * All three cases are normal states, and the screen keeps its lexical colors. Throwing would
	 * surface the failure as an editor error and send the author looking for the cause in their own
	 * code.
	 */
	it("quietly returns nothing when it isn't our worker", async () => {
		expect(
			await provideRuntimeSemanticTokens(model(), range, async () => ({})),
		).toBeNull();
	});

	it("does not use an answer for a model that vanished meanwhile", async () => {
		expect(
			await provideRuntimeSemanticTokens(model(true), range, async () => ({
				getEncodedSemanticClassifications: async () => [2, 4, classify(0)],
			})),
		).toBeNull();
	});
});
