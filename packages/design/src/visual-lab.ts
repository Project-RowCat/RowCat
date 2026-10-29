/**
 * Fixed values for visual QA: both renderers draw the same text.
 *
 * This module lives in the token package for the same reason tokens do. If web and native each
 * wrote their own, the two screens would draw different sentences, and side-by-side screenshots
 * would prove nothing. Differences in line breaks, tracking or density could not be attributed to
 * the font versus the renderer. A single fixed value removes that question.
 *
 * - No product vocabulary. Names like `Story` or `ChatRoom` never appear here. It carries only
 *   text and case names. That is why it lives in the design package rather than `@rowcat/domain`: a
 *   product model here would make the design package product-aware.
 * - Not exported from the root. It is the subpath `@rowcat/design/visual-lab`. If every token
 *   consumer saw these values, one of these sentences would eventually appear on a product screen.
 * - Case names are ledger rows. The values of `VISUAL_LAB_MEASURED` are the labels both apps draw
 *   and the row names in `docs/design/VISUAL-PARITY.md`. If the names diverge, someone must match
 *   rows by eye, and manual matching goes wrong.
 */

/**
 * Both Korean and English are included. Pretendard's Latin and Hangul glyphs take different heights
 * at the same size and wrap lines by different rules. Looking at only one script always leaves a
 * combination where the two apps look identical by accident.
 */
export const VISUAL_LAB_TEXT = {
	/** Latin sample. Measures tracking and baseline. */
	latin: "The quick brown fox jumps over the lazy dog",
	/** Hangul sample. Measures glyph height and line spacing. */
	hangul:
		"\ub2e4\ub78c\uc950 \ud5cc \uccc7\ubc14\ud034\uc5d0 \ud0c0\uace0\ud30c \uc815\ub9d0 \ube60\ub974\uac8c",
	/** Mixed sample. Checks whether the two glyph sets share one baseline within a line. */
	mixed: "RowCat 12 chats · Start a chat",
	/** Long enough to force a line break. Measures paragraph density. */
	paragraph:
		"\uace0\uc591\uc774\ub294 \ubb38\uc744 \uc5f4\uace0 \ub4e4\uc5b4\uc640 \uc544\ubb34 \ub9d0 \uc5c6\uc774 \ucc3d\uac00\uc5d0 \uc549\uc558\ub2e4. The cat said nothing at all.",
	action: "Save",
	actionLatin: "Save",
	/** Second control label, so button hierarchy can be compared side by side. */
	secondaryAction: "Cancel",
	destructiveAction: "Delete",
	fieldLabel: "Display name",
	fieldPlaceholder: "Enter a name",
	fieldValue: "Cat tower",
	multilineValue: "First line.\nSecond line.\nThird line.",
	selectValue: "Claude Sonnet 5",
	selectLabel: "Generation target",
	switchLabel: "Automatic sync",
	sectionTitle: "General",
	cardTitle: "The Moonlit Bookshop",
	cardBody: "A story set in a bookshop that opens only on rainy nights.",
	dialogTitle: "Rename",
	dialogDescription: "Changes this conversation's title.",
	alertTitle: "Delete this conversation?",
	alertDescription:
		"This conversation and all its messages will be deleted. This can't be undone.",
} as const;

/**
 * Rows of the type hierarchy, drawn in this order by both apps. The names come from native's
 * variant vocabulary, because native splits more finely. Web folds `label` and `body` into one tier
 * (both `text-sm`). That split is what this lab must show, so using the web scale as the reference
 * would hide these rows.
 */
export const VISUAL_LAB_TYPE_ROWS = [
	"display",
	"heading",
	"title",
	"body",
	"label",
	"caption",
] as const;

export type VisualLabTypeRow = (typeof VISUAL_LAB_TYPE_ROWS)[number];

/**
 * Five badge labels, meant to sit side by side in one row. A single badge hides a height difference
 * of 1 to 2pt. In a row, that difference shifts the baseline and becomes visible at once.
 */
export const VISUAL_LAB_BADGES = [
	"All ages",
	"Adult",
	"Private",
	"NEW",
	"Archived",
] as const;

/**
 * Cases that are actually measured. Both labs draw values under these names, and the ledger
 * compares the two values by name. Everything here has a numeric answer. Properties that do not
 * reduce to numbers, such as shadow depth or glyph stroke, are excluded. Screenshots judge those.
 */
export const VISUAL_LAB_MEASURED = [
	"button-sm",
	"button-md",
	"button-lg",
	"icon-button",
	"input",
	"textarea",
	"select-trigger",
	"badge",
	"switch",
	"card",
	"panel",
	"app-bar",
	"separator",
] as const;

export type VisualLabMeasuredCase = (typeof VISUAL_LAB_MEASURED)[number];

/**
 * Human-readable case names, drawn on screen so both apps show the same text. When screenshots are
 * placed side by side, the eye can find the matching row.
 */
export const VISUAL_LAB_MEASURED_LABEL: Record<VisualLabMeasuredCase, string> =
	{
		"button-sm": "Button sm",
		"button-md": "Button md",
		"button-lg": "Button lg",
		"icon-button": "IconButton",
		input: "Input",
		textarea: "Textarea",
		"select-trigger": "Select",
		badge: "Badge",
		switch: "Switch",
		card: "Card",
		panel: "Panel",
		"app-bar": "AppBar",
		separator: "Separator",
	};

/**
 * The one-line format for measured values. Both apps must produce the same string.
 *
 * One decimal place, because real measurements are not integers (React Native's onLayout and the
 * browser's getBoundingClientRect both return decimals). Rounding would hide 0.5pt differences, and
 * those differences are what this lab exists to find.
 */
export function formatLabMeasurement(width: number, height: number): string {
	return `${width.toFixed(1)} × ${height.toFixed(1)}`;
}

/**
 * Fixed values for measuring motion. Both labs swap the same words at the same intervals. Unlike
 * the text values above, which make one static picture identical, these make one set of frames
 * identical, so timing is included as well as text.
 *
 * The intervals live here because an interrupted transition is defined by one fact: the next value
 * arrived before the previous transition finished. The interval decides that fact. If each app
 * chose its own, one would interrupt during the outgoing phase and the other during the incoming
 * phase, and side-by-side frames would record different events and could not be compared.
 *
 * The values are hand-written, not derived from rhythm tokens. Deriving them (for example `fast /
 * 2`) would silently move this case to another window whenever the token changes, and that shift
 * would make past ledger measurements incomparable with current ones.
 * - 60ms: inside the outgoing window (`fast` = 120ms). The incoming word has never been visible
 *   yet.
 * - 220ms: after the boundary at 120ms. The incoming word is already about half visible. The
 *   difference between these two events is the point of the case.
 */
export const VISUAL_LAB_MOTION = {
	/**
	 * The three words have different lengths. With equal lengths, the moment of swapping would never
	 * appear on screen, and a case meant to measure geometry would only measure opacity.
	 */
	labels: { a: "Public", b: "Private", c: "Archived" },
	interruptMs: 60,
	lateInterruptMs: 220,
	/** A sentence that appears and then disappears. */
	feedback: "Couldn't save.",
	/**
	 * A sibling that takes the space below that sentence.
	 *
	 * Without this line the exit lifetime is not observed. Opacity alone matches on both platforms.
	 * What differs is when the element beneath moves up.
	 */
	feedbackSibling: "next sibling",
} as const;
