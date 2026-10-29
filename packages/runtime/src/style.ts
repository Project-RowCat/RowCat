/**
 * The initial style contract, deliberately narrow. Widening is always possible; narrowing breaks
 * projects that are already saved. So this slice opens only the axes that both platforms can draw
 * identically once the execution engine arrives.
 * - Not included: CSS strings, className, and selectors. They have meaning only on the web, and
 *   native cannot draw them. Accepting strings would make the grammar inside them the contract, and
 *   the browser owns that grammar.
 * - Not included: position fixed and z-index. Coordinate systems differ by platform. Floating
 *   layers are a presentation capability the runtime provides, not coordinates creators author.
 *   RowCat already decided this elsewhere: there is no generic Sheet in feature code.
 * - Not included: React Native's StyleProp and the web's CSSProperties. Choosing either would
 *   make that platform the contract owner.
 * - Not included: unit strings such as '12px'. If px, dp, and pt share a slot, each renderer
 *   invents its own rule for them. A number is a density-independent unit, and interpreting it is
 *   the host's job.
 * - Color is not here (see color.ts). Its axis cannot be expressed by type alone, so it lives
 *   with its validation function. The sizing bounds and shrink were added just before beta. Both
 *   were found by pressing the flagship app in a browser: a speech bubble could not grow to its
 *   content width, and the shrinking axis differed between two renderers. Widening the vocabulary
 *   is not free. It bumps RUNTIME_API_VERSION, and the host's validation requires an exact match,
 *   so already-published works do not open until republished. Timing is the reason: before public
 *   beta there are no published works, so the cost is zero. After the beta, the republish procedure
 *   must come along (docs/creator-runtime/public-beta.md section 2). Knowingly opening the beta
 *   with a painful axis would make that axis permanently expensive, so these were opened together
 *   here.
 */

import type { RuntimeColor } from "./color.ts";

/**
 * Length is a number or a percentage. `50%` is accepted because percentages exist on both
 * platforms. A template literal type rejects strings such as `50 %` and `abc` at the type level.
 */
export type RuntimeLength = number | `${number}%`;

/** Main-axis alignment. Only the five values that both platforms share. */
export type RuntimeJustify = "start" | "center" | "end" | "between" | "around";

export type RuntimeAlign = "start" | "center" | "end" | "stretch";

/**
 * `padding` is a single number, on the same rule. Per-axis values (paddingX, paddingTop) can be
 * added later, but opening all four now would make each renderer implement its own precedence rules
 * for them.
 */
export interface RuntimeStyle {
	width?: RuntimeLength;
	height?: RuntimeLength;
	/**
	 * The size bounds are one set of four. `width` alone cannot express 'as wide as the content, but
	 * never beyond a limit'. A speech bubble has that shape, and a fixed `width: 86%` makes even a
	 * one-word line take the full width. The four are opened together because widening this axis is a
	 * version bump. Opening them one at a time would pay the same cost four times. They have the same
	 * names and meanings on both platforms (CSS min-width, RN minWidth). Values follow `width`: a
	 * number or a percentage.
	 */
	minWidth?: RuntimeLength;
	maxWidth?: RuntimeLength;
	minHeight?: RuntimeLength;
	maxHeight?: RuntimeLength;
	padding?: number;
	gap?: number;
	/**
	 * Opacity ranges from 0 to 1. The type cannot express the upper bound, so a runtime clamp handles
	 * it.
	 */
	opacity?: number;
	backgroundColor?: RuntimeColor;
	borderRadius?: number;
	justify?: RuntimeJustify;
	align?: RuntimeAlign;
	grow?: number;
	/**
	 * This axis was missing for a while. Whether content could shrink was set entirely by each
	 * renderer's default, and the defaults differed (CSS uses 1, Yoga uses 0). The same work squeezed
	 * vertically on the web, so its scroll disappeared, and a long sentence in a row was cut off on
	 * native. Both renderers now shrink only row children by default. This prop lets creators override
	 * that default. `0` means does not shrink, which differs from not writing a value: an unwritten
	 * value inherits the parent's main-axis default. Negative values are not accepted.
	 */
	shrink?: number;
	/**
	 * Horizontal offset in density-independent units. Absent means `0`. The value is a number, not a
	 * string such as `translateX(8px)`. A string brings a grammar (units, function lists, order,
	 * matrix) whose owner is the browser. With numeric axes the order is fixed by the renderer, so
	 * both platforms use the same order. The move does not change layout. It only changes where the
	 * node is drawn, so neighbors are not pushed. The intermediate states of a transition therefore
	 * match on both platforms, which layout axes do not.
	 */
	translateX?: number;
	translateY?: number;
	/**
	 * Scale factor. Absent means `1`. Negative values are not accepted, since flipping is not part of
	 * this vocabulary. The center is always the node's center. `transformOrigin` is not exposed
	 * because its coordinate system differs by platform. Fixing one default lets both renderers
	 * produce the same picture.
	 */
	scale?: number;
}

/**
 * The text style does not inherit the box style. Extending `RuntimeStyle` would add `gap` and
 * `justify` to `Text`, which have no meaning for text. Accepting and ignoring axes that do not
 * apply would mislead creators.
 */
export interface RuntimeTextStyle {
	color?: RuntimeColor;
	fontSize?: number;
	fontWeight?: "regular" | "medium" | "bold";
	align?: "start" | "center" | "end";
	lines?: number;
	opacity?: number;
}
