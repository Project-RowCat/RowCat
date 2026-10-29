import { space } from "@rowcat/design";

/**
 * Geometry of the discover grid. Everything derives from the column count and one gutter.
 *
 * ## Why this file exists
 *
 * In a grid whose last row is not full, the one remaining card **stretched to the full row.**
 *
 * ```text
 * wanted              what was drawn
 * [card][card]        [card][card]
 * [card][    ]        [    card    ]
 * ```
 *
 * The cause is `flex: 1`. It means "share the remaining space with siblings", not "take one
 * column's width", so in a row with no siblings the whole row becomes that card's share.
 * Development data with an even card count never shows it. It appears only for whoever published an
 * odd number.
 *
 * ## The fix: the cell owns the gutter, not the row
 *
 * Drop `gap` from `columnWrapperStyle`, and give each cell a **half gutter** as inner padding. Two
 * adjacent halves meet to form one gutter. At the outer edges the row's inset is already reduced by
 * one half, so the visible margin stays the same.
 *
 * ```text
 * row inset = edge − half gutter      cell width = 100% / columns      cell padding = half gutter
 * ```
 *
 * It matters that the cell width is a **percentage**. That value ignores how many siblings there
 * are, so a lone card on the last row is still one column wide. Not measuring the screen width is
 * part of the same choice: reading `Dimensions` would go stale on rotation, split screen and
 * foldables.
 *
 * ## Why it lives here and not as values elsewhere
 *
 * The list knows the column count (`numColumns`), and the card knows its width. If the two files
 * each hard-coded the number, changing to three columns would update only one of them, and the
 * symptom would not be an error but **cards pushed outside the row.** Deriving both from one value
 * (`DISCOVER_COLUMNS`) makes that state unrepresentable.
 */

/** Column count. Two 3:4 covers fit at a readable size on a 390pt screen. */
export const DISCOVER_COLUMNS = 2;

/** Space between cards. */
export const DISCOVER_COLUMN_GAP = space.md;

/** Space between the screen edge and the cards. Same scale as the canvas padding (`screenPadding`) on other screens. */
export const DISCOVER_EDGE_INSET = space.lg;

/** Half gutter each cell owns on its inside. Two neighbors meet to form `DISCOVER_COLUMN_GAP`. */
export const DISCOVER_CELL_GUTTER = DISCOVER_COLUMN_GAP / 2;

/** Horizontal row inset. Cells already carry a half gutter, so it is subtracted here in advance. */
export const DISCOVER_ROW_INSET = DISCOVER_EDGE_INSET - DISCOVER_CELL_GUTTER;

/**
 * Width of one cell.
 *
 * **Being a percentage rather than `flex` is the whole of what this slice fixed.** The sibling
 * count does not enter this value, so the width holds even when the last row is not full.
 */
export const DISCOVER_CELL_WIDTH = `${100 / DISCOVER_COLUMNS}%` as const;

/**
 * Width of a drawn card. **The number of cards in the row is not an argument.**
 *
 * The screen does not call this (Yoga does the placement). It exists so a test can verify by value
 * that the derivation above yields the same result as a full row did before. If a gutter change
 * silently widened or narrowed the cards, the grid density would change.
 */
export const discoverCardWidth = (screenWidth: number): number =>
	(screenWidth - 2 * DISCOVER_ROW_INSET) / DISCOVER_COLUMNS -
	2 * DISCOVER_CELL_GUTTER;
