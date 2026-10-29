import type { ColorName, FontWeightName } from "@rowcat/design";
import { fontSize, lineHeight, trackingTight } from "@rowcat/design";
import {
	Text as RNText,
	type StyleProp,
	type TextProps,
	type TextStyle,
} from "react-native";
import { useTheme } from "./theme.tsx";
import { typeface } from "./typography.ts";

/**
 * A single text element. Its purpose is to keep size, weight and color from being written by hand.
 *
 * Before it existed, font sizes from 11 to 22 were scattered across the app with no way to tell
 * which meant the same level. The variant names are that answer.
 *
 * Size and line height come together. If they were separate, a change that only enlarged the font
 * would be common and would show up first as broken line spacing in long text (such as a work
 * description).
 *
 * Color is chosen by meaning. tone takes a token name, not a color value, so light and dark switch
 * automatically.
 *
 * The font is Pretendard, the same as the web. An earlier comment here claimed the platform font
 * was used because the web uses a system stack; that was never true, since the web has pinned
 * Pretendard from the start. Leaving it unset lets the device choose (Apple SD Gothic Neo, or
 * Roboto with Noto Sans KR), so the same Korean screen gets different letter spacing and glyph
 * heights per device. The weight-to-family mapping lives in typography.ts and file registration in
 * apps/mobile. This file fixes only the size, line-height and weight hierarchy.
 */

export type TextVariant =
	/** The screen's main face: brand or login title. One per screen. */
	| "display"
	/** Section heading, such as a work title or the `Comments` heading. */
	| "heading"
	/** Header title or list row title. */
	| "title"
	/** Body text. Chat bubbles and work descriptions use this size. */
	| "body"
	/** Control labels and metadata values. */
	| "label"
	/** Secondary text: captions, timestamps, counts. */
	| "caption";

const VARIANT: Record<
	TextVariant,
	{ fontSize: number; lineHeight: number } & TextStyle
> = {
	/**
	 * Only the two title variants tighten letter spacing, matching the web's tracking-tight.
	 *
	 * The web uses em, which scales with font size automatically. RN's letterSpacing is absolute, so
	 * it must be multiplied per size (see trackingTight). One constant would look right at 24pt and
	 * too wide at 20pt.
	 */
	display: {
		fontSize: fontSize.display,
		letterSpacing: fontSize.display * trackingTight,
		lineHeight: lineHeight.display,
		...typeface("bold"),
	},
	heading: {
		fontSize: fontSize.heading,
		letterSpacing: fontSize.heading * trackingTight,
		lineHeight: lineHeight.heading,
		...typeface("bold"),
	},
	title: {
		fontSize: fontSize.title,
		lineHeight: lineHeight.title,
		...typeface("semibold"),
	},
	body: {
		fontSize: fontSize.body,
		lineHeight: lineHeight.body,
		...typeface("regular"),
	},
	label: {
		fontSize: fontSize.label,
		lineHeight: lineHeight.label,
		...typeface("medium"),
	},
	caption: {
		fontSize: fontSize.caption,
		lineHeight: lineHeight.caption,
		...typeface("regular"),
	},
};

export interface TextOwnProps {
	variant?: TextVariant;
	/** Semantic color token. Defaults to `foreground`, the screen's normal text color. */
	tone?: ColorName;
	/**
	 * Overrides the variant's default weight. Size cannot be overridden, because a different size
	 * means a different variant.
	 */
	weight?: FontWeightName;
	/**
	 * Line-height variant. The default pairs with the variant; `reading` is a second, longer value for
	 * long text (the web's leading-7).
	 *
	 * Unlike weight, it does not override size, so the hierarchy stays fixed. It is opened because
	 * three places actually differ: work descriptions, comment bodies and assistant replies. The web
	 * uses one value for all three, but here they were 22, 25 and 22, and none matched the web.
	 */
	leading?: "default" | "reading";
	style?: StyleProp<TextStyle>;
}

export function Text({
	variant = "body",
	tone = "foreground",
	weight,
	leading,
	style,
	...props
}: TextProps & TextOwnProps) {
	const { colors } = useTheme();
	const base = VARIANT[variant];
	return (
		<RNText
			{...props}
			style={[
				base,
				{ color: colors[tone] },
				weight ? typeface(weight) : null,
				leading === "reading" ? { lineHeight: lineHeight.reading } : null,
				style,
			]}
		/>
	);
}
