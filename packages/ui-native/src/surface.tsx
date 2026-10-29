import * as SeparatorPrimitive from "@rn-primitives/separator";
import { borderWidth, radiusScale, space } from "@rowcat/design";
import type { ReactNode } from "react";
import { type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";
import { useTheme } from "./theme.tsx";

/**
 * Surface levels, matching the web hierarchy:
 * - background: the floor of the screen
 * - card: floats above the floor; one border line separates it from background
 * - muted: a faint sub-area inside a surface, such as a cover placeholder or avatar fill
 *
 * There are deliberately only three. Each feature choosing its own gray (the code had `#141416`,
 * `#18181b` and `#1f1f23` mixed) makes it impossible to tell whether two cards are the same kind.
 *
 * The web has two box shapes, not one:
 * - Card: gallery work card (the @rowcat/ui-web Card primitive). Radius 14, ring-1 at
 *   foreground/10, shadow-xs, padding owned by the content.
 * - Panel: section box inside a screen (rounded-lg border bg-card p-3). Radius 10, 1px border, no
 *   shadow, padding 12. Creator work rows, guardian notices and analytics summaries use this shape.
 *
 * An earlier single box matched neither shape (radius 14, border, padding 16, no shadow). Work
 * cards came out flatter than the web's, and section boxes rounder and looser. The tokens were
 * correct; the shape values were not.
 */

export function Card({
	children,
	style,
	padded = true,
}: {
	children: ReactNode;
	style?: StyleProp<ViewStyle>;
	/**
	 * When false, drops the inner padding so content reaches the edges. For cards whose cover sits at
	 * the top.
	 */
	padded?: boolean;
}) {
	const { colors, alpha } = useTheme();
	return (
		<View
			style={[
				surface.card,
				{ backgroundColor: colors.card },
				surface.raised,
				padded && surface.padded,
				style,
			]}
		>
			{children}
			{/**
			 * The ring does not take part in layout, like the web's ring-1: it is drawn as an overlay and does
			 * not
			 * change the box size.
			 *
			 * This was once borderWidth: 1, which added 1pt top and bottom. The same card measured 74 in the
			 * app and
			 * 72 on the web. The parity notes called this an intentional difference because RN has no ring.
			 * That is
			 * not a reason it cannot be matched: a non-layout layer on top produces the same picture.
			 *
			 * The color is 10% of the foreground rather than a border token, as on the web, so it follows each
			 * appearance the same way the web does.
			 *
			 * It must not receive touches (`pointerEvents="none"`). Otherwise the ring would intercept presses
			 * meant
			 * for the whole card.
			 */}
			<View
				pointerEvents="none"
				style={[surface.ring, { borderColor: alpha("foreground", 0.1) }]}
			/>
		</View>
	);
}

/**
 * Section box for in-screen content: the web's rounded-lg border bg-card p-3.
 *
 * Kept separate from Card on purpose. Both use the same background color but are different boxes;
 * merging them would make one of them differ from the web. The lack of a shadow is the main
 * difference: this box groups its content with a border instead of floating above the screen.
 */
export function Panel({
	children,
	style,
	padded = true,
}: {
	children: ReactNode;
	style?: StyleProp<ViewStyle>;
	padded?: boolean;
}) {
	const { colors } = useTheme();
	return (
		<View
			style={[
				surface.panel,
				{ backgroundColor: colors.card, borderColor: colors.border },
				padded && surface.panelPadded,
				style,
			]}
		>
			{children}
		</View>
	);
}

/**
 * Divider drawn in the border color, exactly one device pixel thick (borderWidth, not 1). Using
 * height 1 would draw a 3-pixel line on 3x density screens.
 *
 * The role is set by @rn-primitives/separator: decorative maps to role presentation, otherwise
 * separator. That distinction matters. Lines between list rows are decorative, and a screen reader
 * reading them is noise. Lines that divide sections must be read so the screen's structure comes
 * through. Hand-written dividers would make that choice differ from place to place.
 */
export function Separator({
	style,
	decorative = true,
	orientation = "horizontal",
}: {
	style?: StyleProp<ViewStyle>;
	/**
	 * Defaults to decorative, since most lines in this app sit between list rows. Set it to false
	 * where a line divides sections, so screen readers announce the boundary.
	 */
	decorative?: boolean;
	orientation?: "horizontal" | "vertical";
}) {
	const { colors } = useTheme();
	return (
		<SeparatorPrimitive.Root
			decorative={decorative}
			orientation={orientation}
			style={[
				orientation === "horizontal" ? surface.separator : surface.separatorY,
				{ backgroundColor: colors.border },
				style,
			]}
		/>
	);
}

const surface = StyleSheet.create({
	card: {
		borderRadius: radiusScale.xl,
		overflow: "hidden",
	},
	/**
	 * Border layer inside the box, flush with its inner edge. Its radius matches the outer box, and
	 * overflow hidden clips it to the card's curve, so the line never sticks out at the corners.
	 */
	ring: {
		borderRadius: radiusScale.xl,
		borderWidth: borderWidth,
		bottom: 0,
		left: 0,
		position: "absolute",
		right: 0,
		top: 0,
	},
	/**
	 * Same shadow as the web's shadow-xs (0 1px 2px rgba(0,0,0,.05)).
	 *
	 * In dark mode it is effectively invisible; in light mode it lifts the card off the floor, which
	 * is what the web shadow does. elevation is the Android counterpart; whether the two read as the
	 * same depth is checked on each platform separately.
	 *
	 * shadowColor is left unset, as in the menu: the default is black, and choosing a color would add
	 * a color outside the token set.
	 */
	raised: {
		elevation: 1,
		shadowOffset: { height: 1, width: 0 },
		shadowOpacity: 0.05,
		shadowRadius: 2,
	},
	padded: { padding: space.lg },
	panel: {
		borderRadius: radiusScale.lg,
		borderWidth: borderWidth,
		overflow: "hidden",
	},
	/** The web's p-3, narrow-screen value. sm:p-4 starts at 640px, a width this app does not reach. */
	panelPadded: { padding: space.md },
	separator: { height: borderWidth, width: "100%" },
	separatorY: { height: "100%", width: borderWidth },
});
