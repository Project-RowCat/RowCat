import type { RuntimeHostValue } from "@rowcat/runtime-host/patches";
import { describe, expect, it } from "vitest";
import { WebRuntimeRendererError } from "./errors.ts";
import {
	boxStyleCss,
	lengthCss,
	opacityCss,
	progressStyleCss,
	textStyleCss,
} from "./styles.ts";
import { WEB_RUNTIME_BASE_CSS } from "./theme.ts";

const entries = (map: Map<string, string>) => Object.fromEntries(map);

describe("length", () => {
	it("numbers are px and percentages stay as is", () => {
		expect(lengthCss("width", 120)).toBe("120px");
		expect(lengthCss("width", 0)).toBe("0px");
		expect(lengthCss("width", 12.5)).toBe("12.5px");
		expect(lengthCss("width", "50%")).toBe("50%");
		expect(lengthCss("width", "33.3%")).toBe("33.3%");
	});

	it("arbitrary CSS unit strings are not accepted", () => {
		for (const bad of ["12px", "1rem", "auto", "calc(100% - 1px)", "50 %", ""])
			expect(() => lengthCss("width", bad)).toThrowError(
				WebRuntimeRendererError,
			);
	});
});

describe("box style", () => {
	it("only axes written in the docs become CSS", () => {
		expect(
			entries(
				boxStyleCss({
					width: 120,
					height: "50%",
					padding: 16,
					gap: 8,
					opacity: 0.5,
					backgroundColor: "#111111",
					borderRadius: 12,
					justify: "between",
					align: "stretch",
					grow: 1,
				}),
			),
		).toEqual({
			width: "120px",
			height: "50%",
			padding: "16px",
			gap: "8px",
			opacity: "0.5",
			"background-color": "#111111",
			"border-radius": "12px",
			"justify-content": "space-between",
			"align-items": "stretch",
			"flex-grow": "1",
		});
	});

	it("justify and align vocabularies carry over by the table", () => {
		const justify = ["start", "center", "end", "between", "around"] as const;
		expect(
			justify.map((value) =>
				boxStyleCss({ justify: value }).get("justify-content"),
			),
		).toEqual([
			"flex-start",
			"center",
			"flex-end",
			"space-between",
			"space-around",
		]);
		const align = ["start", "center", "end", "stretch"] as const;
		expect(
			align.map((value) => boxStyleCss({ align: value }).get("align-items")),
		).toEqual(["flex-start", "center", "flex-end", "stretch"]);
	});

	it("unknown keys do not become CSS and are a contract error", () => {
		const styles: RuntimeHostValue[] = [
			{ position: "fixed" },
			{ zIndex: 10 },
			{ fontFamily: "serif" },
			{ background: "url(x)" },
		];
		for (const style of styles)
			expect(() => boxStyleCss(style)).toThrowError(
				expect.objectContaining({ code: "renderer_contract" }),
			);
	});

	it("colors pass only in the three supported formats", () => {
		expect(
			boxStyleCss({ backgroundColor: "#abc" }).get("background-color"),
		).toBe("#abc");
		expect(
			boxStyleCss({ backgroundColor: "#aabbccdd" }).get("background-color"),
		).toBe("#aabbccdd");
		for (const bad of ["red", "rgb(0,0,0)", "#zzz", "url(x)", "#abcd", 12])
			expect(() => boxStyleCss({ backgroundColor: bad })).toThrowError(
				WebRuntimeRendererError,
			);
	});

	it("opacity folds to 0 to 1", () => {
		expect(opacityCss("opacity", 2)).toBe("1");
		expect(opacityCss("opacity", -1)).toBe("0");
		expect(opacityCss("opacity", 0.25)).toBe("0.25");
		expect(() => opacityCss("opacity", "0.5")).toThrowError(
			WebRuntimeRendererError,
		);
	});

	/**
	 * An explicit gap prop beats style.gap. The result must not depend on the browser's assignment
	 * order.
	 */
	it("the gap prop beats style.gap", () => {
		expect(boxStyleCss({ gap: 4 }, 12).get("gap")).toBe("12px");
		expect(boxStyleCss({ gap: 4 }, null).get("gap")).toBe("4px");
		expect(boxStyleCss(null, 12).get("gap")).toBe("12px");
		expect(boxStyleCss(null, null).has("gap")).toBe(false);
	});

	it("a non-object style is a contract error", () => {
		expect(() => boxStyleCss("padding: 4px")).toThrowError(
			WebRuntimeRendererError,
		);
		expect(() => boxStyleCss([1, 2])).toThrowError(WebRuntimeRendererError);
	});
});

describe("text style", () => {
	it("only axes written in the docs become CSS", () => {
		expect(
			entries(
				textStyleCss({
					color: "#ffffff",
					fontSize: 20,
					fontWeight: "bold",
					align: "center",
					opacity: 0.8,
				}),
			),
		).toEqual({
			color: "#ffffff",
			"font-size": "20px",
			"font-weight": "700",
			"text-align": "center",
			opacity: "0.8",
		});
		expect(textStyleCss({ fontWeight: "regular" }).get("font-weight")).toBe(
			"400",
		);
		expect(textStyleCss({ fontWeight: "medium" }).get("font-weight")).toBe(
			"500",
		);
	});

	it("lines becomes the line-clamp idiom and takes only positive integers", () => {
		const css = textStyleCss({ lines: 2 });
		expect(css.get("-webkit-line-clamp")).toBe("2");
		expect(css.get("overflow")).toBe("hidden");
		for (const bad of [0, -1, 1.5, "2"])
			expect(() => textStyleCss({ lines: bad })).toThrowError(
				WebRuntimeRendererError,
			);
	});

	it("box axes do not apply to text", () => {
		expect(() => textStyleCss({ gap: 4 })).toThrowError(
			WebRuntimeRendererError,
		);
		expect(() => textStyleCss({ justify: "center" })).toThrowError(
			WebRuntimeRendererError,
		);
	});
});

describe("progress style", () => {
	it("width only", () => {
		expect(entries(progressStyleCss({ width: "50%" }))).toEqual({
			width: "50%",
		});
		expect(() => progressStyleCss({ height: 4 })).toThrowError(
			WebRuntimeRendererError,
		);
	});
});

/**
 * Four size bounds and shrink. These axes were opened just before the public beta
 * (RUNTIME_API_VERSION 7).
 */
describe("size bounds and yielding", () => {
	it("the four bounds go to CSS's same names", () => {
		expect(
			boxStyleCss({
				minWidth: 40,
				maxWidth: "86%",
				minHeight: 12,
				maxHeight: "50%",
			}),
		).toEqual(
			new Map([
				["min-width", "40px"],
				["max-width", "86%"],
				["min-height", "12px"],
				["max-height", "50%"],
			]),
		);
	});

	it("shrink is flex-shrink and 0 is a value too", () => {
		expect(boxStyleCss({ shrink: 1 }).get("flex-shrink")).toBe("1");
		expect(boxStyleCss({ shrink: 0 }).get("flex-shrink")).toBe("0");
	});

	/**
	 * Browsers silently ignore negative values. Left alone, the creator would believe the value they
	 * wrote is working.
	 */
	it("negative shrink is a contract error", () => {
		expect(() => boxStyleCss({ shrink: -1 })).toThrow(/negative/);
	});

	it("length vocabulary is the same as width", () => {
		expect(() => boxStyleCss({ maxWidth: "1rem" as never })).toThrow();
	});
});

/**
 * Shrinking axes: both renderers must give the same answer. CSS flex-shrink defaults to 1 and Yoga
 * defaults to 0.
 *
 * Left uncorrected on the web, children of a fixed-height ancestor were squeezed rather than
 * overflowing. The ScrollView did not scroll, and overflowing text overlapped the next card. It
 * surfaced only in the flagship on a real browser, since short screens fit the viewport.
 *
 * The rule: only children of a row shrink, since text can wrap only if it may shrink. The native
 * counterpart is runtimeStyles.rowChild.
 *
 * jsdom does no layout, so this test reads the sheet's rules. Real layout evidence comes from the
 * browser.
 */
describe("the shrinking axis", () => {
	/** Strip comments first. A comment placed before a selector would stop that rule from matching. */
	const sheet = WEB_RUNTIME_BASE_CSS.replace(/\/\*[\s\S]*?\*\//g, "");

	/**
	 * Returns every declaration block for the selector, in sheet order. Later rules win, so order
	 * matters.
	 */
	const declarationsFor = (selector: string): string[] =>
		[...sheet.matchAll(/([^{}]+)\{([^}]*)\}/g)]
			.filter((rule) =>
				rule[1]
					.split(",")
					.map((part) => part.trim())
					.includes(selector),
			)
			.map((rule) => rule[2]);

	const shrinkOf = (selector: string): string | null => {
		const found = declarationsFor(selector)
			.flatMap((block) => [...block.matchAll(/flex-shrink:\s*([^;]+);/g)])
			.map((match) => match[1].trim());
		return found.length === 0 ? null : found[found.length - 1];
	};

	it("children of vertically stacked boxes do not shrink", () => {
		for (const parent of [
			".rc-root > *",
			".rc-screen > *",
			".rc-view > *",
			".rc-stack > *",
			".rc-scroll > *",
		])
			expect(shrinkOf(parent), parent).toBe("0");
	});

	it("children of rows shrink, so long sentences wrap", () => {
		expect(shrinkOf(".rc-row > *")).toBe("1");
	});

	/**
	 * Three elements that have their own size are exempt from shrinking even inside a row. The native
	 * renderer excludes the same three.
	 */
	it("images, progress bars and buttons do not shrink even in rows", () => {
		expect(shrinkOf(".rc-row > .rc-image")).toBe("0");
		expect(shrinkOf(".rc-row > .rc-progress")).toBe("0");
		expect(shrinkOf(".rc-row > .rc-button")).toBe("0");
	});

	/**
	 * Pressable is not an exception. It accepts style, so the creator can write shrink: 0 themselves.
	 * It is a container for arbitrary content and cannot claim its own size. Without this test, a
	 * change widening the rule to 'exempt everything pressable' would pass green.
	 */
	it("pressable containers are not an exception", () => {
		expect(shrinkOf(".rc-row > .rc-pressable")).toBeNull();
	});
});
