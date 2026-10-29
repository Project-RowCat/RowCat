import { describe, expect, it } from "vitest";
import { applyChatEmphasisMarker } from "./composer-emphasis.ts";

/**
 * The rule for applying an emphasis marker. A single space is the reason this function exists.
 * CommonMark emphasis does not form when whitespace follows the opening asterisk or precedes the
 * closing one. A space the user selects by accident turns the wrap into `*word *`, which does not
 * render, and the asterisks stay visible on screen. It fails silently, with no error to explain it.
 */

const apply = (text: string, start: number, end = start) =>
	applyChatEmphasisMarker({ text, selectionStart: start, selectionEnd: end });

describe("applyChatEmphasisMarker", () => {
	it("wraps the selection and re-selects the inner text", () => {
		const next = apply("문을 연다", 0, 5);
		expect(next.text).toBe("*문을 연다*");
		expect(next.text.slice(next.selectionStart, next.selectionEnd)).toBe(
			"문을 연다",
		);
	});

	/**
	 * This line is the core of the function: wrapping the surrounding whitespace prevents the marker
	 * from forming.
	 */
	it("surrounding whitespace stays outside the markers", () => {
		expect(apply("그는 문을 연다 그리고", 3, 9).text).toBe(
			"그는 *문을 연다* 그리고",
		);
		expect(apply("문을 연다 ", 0, 6).text).toBe("*문을 연다* ");
	});

	it("without a selection it inserts empty markers with the caret between", () => {
		const next = apply("그는 ", 3);
		expect(next.text).toBe("그는 **");
		expect(next.selectionStart).toBe(4);
		expect(next.selectionEnd).toBe(4);
	});

	/**
	 * Also applies when only whitespace is selected. There is no content to wrap, so an empty marker
	 * is placed at that spot.
	 */
	it("selecting only whitespace stands empty markers there", () => {
		const next = apply("가  나", 1, 3);
		expect(next.text).toBe("가  **나");
		expect(next.selectionStart).toBe(next.selectionEnd);
	});

	it("selecting several lines keeps the lines", () => {
		expect(apply("문을 연다\n밖으로 나간다", 0, 15).text).toBe(
			"*문을 연다\n밖으로 나간다*",
		);
	});

	/** The caller's range may be reversed or point outside the text, so the values are not trusted. */
	it("folds reversed ranges and out-of-text values inward", () => {
		expect(apply("문을 연다", 5, 0).text).toBe("*문을 연다*");
		expect(apply("가", 99, 99).text).toBe("가**");
		expect(apply("가", -5, 1).text).toBe("*가*");
	});

	/**
	 * Wrapping text that already has a marker is not blocked. This is not a toggle, so the markers
	 * stack.
	 */
	it("wrapping already wrapped text nests as is", () => {
		expect(apply("*문을 연다*", 0, 7).text).toBe("**문을 연다**");
	});
});
