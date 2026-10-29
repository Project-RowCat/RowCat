import { describe, expect, it } from "vitest";
import {
	boxStyleOf,
	lengthValue,
	progressStyleOf,
	textStyleOf,
} from "./styles.ts";

describe("length", () => {
	it("numbers are dp and percentages stay as is", () => {
		expect(lengthValue("width", 12)).toBe(12);
		expect(lengthValue("width", "50%")).toBe("50%");
	});

	it("other unit strings are off contract", () => {
		expect(() => lengthValue("width", "1rem")).toThrow(/percentage/);
		expect(() => lengthValue("width", "12px")).toThrow(/percentage/);
		expect(() => lengthValue("width", Number.NaN)).toThrow(/finite/);
	});
});

describe("box style", () => {
	it("moves each axis one by one", () => {
		expect(
			boxStyleOf({
				width: 100,
				height: "50%",
				padding: 8,
				gap: 4,
				opacity: 0.5,
				backgroundColor: "#ff00aa",
				borderRadius: 6,
				justify: "between",
				align: "stretch",
				grow: 1,
			}),
		).toEqual({
			width: 100,
			height: "50%",
			padding: 8,
			gap: 4,
			opacity: 0.5,
			backgroundColor: "#ff00aa",
			borderRadius: 6,
			justifyContent: "space-between",
			alignItems: "stretch",
			flexGrow: 1,
		});
	});

	it("refuses unknown keys", () => {
		expect(() => boxStyleOf({ zIndex: 1 })).toThrow(/unknown style property/);
		expect(() => boxStyleOf({ position: "absolute" })).toThrow(/unknown/);
		expect(() => boxStyleOf({ fontFamily: "Pretendard" })).toThrow(/unknown/);
	});

	it("refuses colors that are not colors", () => {
		expect(() => boxStyleOf({ backgroundColor: "red" })).toThrow(/color/);
		expect(() => boxStyleOf({ backgroundColor: "#gggggg" })).toThrow(/color/);
		expect(boxStyleOf({ backgroundColor: "#fff" })).toEqual({
			backgroundColor: "#fff",
		});
	});

	it("folds opacity to 0 to 1", () => {
		expect(boxStyleOf({ opacity: 2 })).toEqual({ opacity: 1 });
		expect(boxStyleOf({ opacity: -1 })).toEqual({ opacity: 0 });
	});

	it("an explicit gap beats style.gap", () => {
		expect(boxStyleOf({ gap: 4 }, 12)).toEqual({ gap: 12 });
		expect(boxStyleOf(null, 12)).toEqual({ gap: 12 });
		expect(boxStyleOf(null)).toEqual({});
	});
});

describe("text style", () => {
	it("moves each axis one by one and emits lines separately", () => {
		expect(
			textStyleOf({
				color: "#112233",
				fontSize: 15,
				fontWeight: "bold",
				align: "center",
				lines: 2,
				opacity: 0.8,
			}),
		).toEqual({
			style: {
				color: "#112233",
				fontSize: 15,
				fontWeight: "700",
				textAlign: "center",
				opacity: 0.8,
			},
			lines: 2,
		});
	});

	it("logical directions fold to left and right", () => {
		expect(textStyleOf({ align: "start" }).style.textAlign).toBe("left");
		expect(textStyleOf({ align: "end" }).style.textAlign).toBe("right");
	});

	it("lines is a positive integer", () => {
		expect(() => textStyleOf({ lines: 0 })).toThrow(/positive integer/);
		expect(() => textStyleOf({ lines: 1.5 })).toThrow(/positive integer/);
	});

	it("refuses unknown keys", () => {
		expect(() => textStyleOf({ letterSpacing: 1 })).toThrow(/unknown/);
	});
});

describe("progress style", () => {
	it("width only", () => {
		expect(progressStyleOf({ width: "80%" })).toEqual({ width: "80%" });
		expect(() => progressStyleOf({ height: 4 })).toThrow(/unknown/);
	});
});

/**
 * The four size bounds and shrink must use the same vocabulary and the same rejections as the web
 * renderer.
 */
describe("size bounds and yielding", () => {
	it("the four bounds go to RN's same names", () => {
		expect(
			boxStyleOf({
				minWidth: 40,
				maxWidth: "86%",
				minHeight: 12,
				maxHeight: "50%",
			}),
		).toEqual({
			minWidth: 40,
			maxWidth: "86%",
			minHeight: 12,
			maxHeight: "50%",
		});
	});

	it("shrink is flexShrink and 0 is a value too", () => {
		expect(boxStyleOf({ shrink: 1 })).toEqual({ flexShrink: 1 });
		expect(boxStyleOf({ shrink: 0 })).toEqual({ flexShrink: 0 });
	});

	it("negative shrink is a contract error", () => {
		expect(() => boxStyleOf({ shrink: -1 })).toThrow(/negative/);
	});

	it("length vocabulary is the same as width", () => {
		expect(() => boxStyleOf({ maxWidth: "1rem" })).toThrow(/percentage/);
	});
});
