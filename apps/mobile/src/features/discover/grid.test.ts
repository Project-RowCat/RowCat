import { describe, expect, it } from "vitest";
import {
	DISCOVER_CELL_GUTTER,
	DISCOVER_CELL_WIDTH,
	DISCOVER_COLUMN_GAP,
	DISCOVER_COLUMNS,
	DISCOVER_EDGE_INSET,
	DISCOVER_ROW_INSET,
	discoverCardWidth,
} from "./grid.ts";

/**
 * Grid geometry. **Card width is the same even when the last row is not full.**
 *
 * The tests of this app do not render screens, so the layout Yoga actually produces cannot be
 * observed here. Instead the **inputs** of the layout are locked: that the cell width is a value
 * that ignores the sibling count (a percentage), and that the derivation moving the gutter into the
 * cell yields the same card width as a full row did before.
 */

/**
 * The arithmetic from when the gutter lived in the row. This slice changed **where the margins
 * sit**, not how wide the cards are. The claim is kept here as a value.
 */
const legacyFullRowCardWidth = (screenWidth: number): number =>
	(screenWidth - 2 * DISCOVER_EDGE_INSET - DISCOVER_COLUMN_GAP) /
	DISCOVER_COLUMNS;

describe("cell width doesn't hang on the row's count", () => {
	/**
	 * With `flex: 1` this value would become "a share of the remaining space", which is 100% in a row
	 * with no siblings. A percentage does not look at siblings.
	 */
	it("cell width is a percentage derived from the column count", () => {
		expect(DISCOVER_CELL_WIDTH).toBe("50%");
		expect(DISCOVER_CELL_WIDTH.endsWith("%")).toBe(true);
	});

	/**
	 * A percentage resolves against the parent's **content box**, so the cell is `(row content width)
	 * / columns` whether the row holds one card or two. The arithmetic reproduces that and checks it
	 * for 1, 2, 3, 5 and 24 cards.
	 */
	it.each([
		320, 375, 390, 430,
	])("independent of count at %dpt", (screenWidth) => {
		const cell = (screenWidth - 2 * DISCOVER_ROW_INSET) / DISCOVER_COLUMNS;
		const expected = cell - 2 * DISCOVER_CELL_GUTTER;

		/**
		 * 1, 3 and 5 cards leave a single card on the last row, while 2, 4 and 24 fill it. That the card
		 * width is the same in both cases is the whole requirement of this slice.
		 */
		for (const count of [1, 2, 3, 4, 5, 24]) {
			const rows = Math.ceil(count / DISCOVER_COLUMNS);
			const lastRowItems = count - (rows - 1) * DISCOVER_COLUMNS;
			expect(lastRowItems).toBeGreaterThan(0);
			expect(lastRowItems).toBeLessThanOrEqual(DISCOVER_COLUMNS);
			/** Neither `count` nor `lastRowItems` enters the width. That is the guarantee. */
			expect(discoverCardWidth(screenWidth)).toBe(expected);
		}
	});
});

describe("the visible margins stay the same", () => {
	/** Outer edge: row inset + the cell's half gutter = the old edge margin. */
	it("edge margins are preserved", () => {
		expect(DISCOVER_ROW_INSET + DISCOVER_CELL_GUTTER).toBe(DISCOVER_EDGE_INSET);
	});

	/** Between cards: the halves of two neighboring cells meet to form one gutter. */
	it("the gap between columns is preserved", () => {
		expect(DISCOVER_CELL_GUTTER * 2).toBe(DISCOVER_COLUMN_GAP);
	});

	it.each([
		320, 375, 390, 430,
	])("card width at %dpt is the same as before", (width) => {
		expect(discoverCardWidth(width)).toBe(legacyFullRowCardWidth(width));
	});

	/** The gutter must split into integers. If a half is fractional, the cards in the two columns differ by half a pixel. */
	it("the half gutter is an integer", () => {
		expect(Number.isInteger(DISCOVER_CELL_GUTTER)).toBe(true);
	});
});

describe("the column count comes from one place", () => {
	it("two columns", () => {
		expect(DISCOVER_COLUMNS).toBe(2);
	});
});
