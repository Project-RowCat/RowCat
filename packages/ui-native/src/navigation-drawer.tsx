import * as DialogPrimitive from "@rn-primitives/dialog";
import { borderWidth, radiusScale, space } from "@rowcat/design";
import type { ReactNode } from "react";
import { ScrollView, StyleSheet, useWindowDimensions } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "./icon.tsx";
import { controlHeight, targetSlop } from "./metrics.ts";
import {
	useBackdropStyle,
	useDrawerPanelStyle,
	useDrawerPresence,
} from "./motion/animate.ts";
import { SCRIM_COLOR, ScrimBlur } from "./scrim.tsx";
import { useTheme } from "./theme.tsx";

/**
 * Left-edge global navigation surface. It is not a general sheet: placement, size, and snap points
 * are fixed by the API. Forms go to Dialog, irreversible confirmations to AlertDialog,
 * trigger-bound action groups to DropdownMenu, and short single choices to ChoiceSheet.
 * - The trigger is exported with the drawer so focus returns to it on close. Focus restore only
 *   works when the trigger is inside Root.
 * - Accessibility and back behavior come from the primitive: aria-modal, the escape gesture,
 *   Android back closing this surface, focus on open, and backdrop tap.
 * - The panel extends to the physical edges; only inner padding takes safe-area insets.
 * - One ScrollView owns scrolling. Nesting a FlatList would disable virtualization, and this
 *   content is a short bounded list.
 */

/**
 * Width cap for wide devices. It sits between the web's 240px sidebar and the 288px (w-72) narrow
 * drawer. A finger-opened surface needs more room than the web sidebar, and on a 320pt device at
 * least 40pt of the backdrop must stay visible so the panel reads as overlaid, not covering.
 */
const DRAWER_MAX_WIDTH = 280;

/**
 * Share of the screen left visible behind the drawer on the narrowest devices. A single fixed cap
 * would take 88% of a 320pt screen and leave almost no backdrop to tap to close. This ratio keeps
 * that area.
 */
const DRAWER_MAX_WIDTH_RATIO = 0.85;

export function NavigationDrawer({
	title,
	triggerLabel,
	open,
	onOpenChange,
	children,
}: {
	/**
	 * Accessible name of the drawer, announced when it opens. It is not the visible title: the first
	 * line of the drawer is the brand, so repeating the title would read the same words twice. RN has
	 * no aria-labelledby, so the container carries the name.
	 */
	title: string;
	/**
	 * Accessible name of the trigger. It says where the drawer opens, not just `Menu`: a
	 * screen-reader user cannot tell what a menu opens from the word alone.
	 */
	triggerLabel: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	children: ReactNode;
}) {
	const { colors } = useTheme();
	const insets = useSafeAreaInsets();
	const { width } = useWindowDimensions();

	const panelWidth = Math.min(DRAWER_MAX_WIDTH, width * DRAWER_MAX_WIDTH_RATIO);

	/**
	 * Keeps the content mounted during the closing motion. The primitive unmounts portal content as
	 * soon as `open` becomes false, so `mounted` is kept alive separately. Root receives it; callers
	 * still own `open`. The wiring lives in motion/animate.ts, shared by five primitives. Reduced
	 * motion is not checked here: the shared rhythm applies it (transforms jump to the final value,
	 * opacity still fades), and Reanimated reads the device setting, so AccessibilityInfo is not
	 * subscribed a second time.
	 */
	const presence = useDrawerPresence(open);
	const backdropStyle = useBackdropStyle(presence);
	const panelStyle = useDrawerPanelStyle(presence, panelWidth);

	return (
		<DialogPrimitive.Root
			open={presence.mounted}
			onOpenChange={(next) => {
				/**
				 * Close requests from the primitive (backdrop tap, Android back, escape) pass through to the
				 * caller. Opening also goes through the caller's `open`, the only source of truth for openness.
				 * `mounted` is just a shadow for the closing motion.
				 */
				if (next !== open) onOpenChange(next);
			}}
			style={drawer.root}
		>
			<DialogPrimitive.Trigger
				accessibilityLabel={triggerLabel}
				/**
				 * Flips from the caller's `open`, not the primitive's. The primitive's trigger flips its own
				 * `open` (which is `mounted` here). During the 120ms closing motion the two differ, so a press
				 * would count as already closed and do nothing. This handler runs after the primitive's, so the
				 * last answer wins.
				 */
				onPress={() => onOpenChange(!open)}
				hitSlop={targetSlop(controlHeight.md)}
				style={({ pressed }) => [drawer.trigger, pressed && drawer.pressed]}
			>
				<Icon name="navigation" size="lg" />
			</DialogPrimitive.Trigger>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay style={drawer.overlay}>
					{/**
					 * The backdrop color sits inside this view. The primitive's Overlay is a Pressable and cannot take
					 * a
					 * style interpolated on the native driver. Turning it into an Animated component goes through
					 * asChild + Slot, which also loses press handling in this version.
					 */}
					<Animated.View style={[drawer.overlayFill, backdropStyle]}>
						<ScrimBlur />
					</Animated.View>
				</DialogPrimitive.Overlay>
				<DialogPrimitive.Content
					/**
					 * RN has no aria-labelledby to point at the title node, so the container's own label names the
					 * surface.
					 */
					accessibilityLabel={title}
					/**
					 * The layer covers the screen but lets touches through. Without this, a tap outside the drawer
					 * lands on the layer instead of the backdrop, and the drawer never closes. dialog.tsx sets the
					 * same value in the same place.
					 */
					pointerEvents="box-none"
					style={drawer.content}
				>
					<Animated.View
						style={[
							drawer.panel,
							panelStyle,
							{
								backgroundColor: colors.background,
								borderRightColor: colors.border,
								width: panelWidth,
							},
						]}
					>
						<ScrollView
							contentContainerStyle={{
								/**
								 * The panel extends to the physical edges and only the padding respects safe-area insets.
								 * The left inset is added for landscape cutouts. The right side is inside the screen, so
								 * nothing is added.
								 */
								paddingBottom: space.lg + insets.bottom,
								paddingLeft: space.md + insets.left,
								paddingRight: space.md,
								paddingTop: space.md + insets.top,
							}}
							/** Scrolling inside the drawer must not close it. */
							keyboardShouldPersistTaps="handled"
						>
							{children}
						</ScrollView>
					</Animated.View>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}

const drawer = StyleSheet.create({
	/**
	 * The root is a single View around the trigger. It sits in the header row, so it is pinned not to
	 * shrink: when the title gets long, the title is what shrinks.
	 */
	root: { flexShrink: 0 },
	/**
	 * The visible box is 36 square, matching the web's icon button. hitSlop widens the touch target.
	 */
	trigger: {
		alignItems: "center",
		height: controlHeight.md,
		justifyContent: "center",
		width: controlHeight.md,
	},
	pressed: { opacity: 0.6 },
	/**
	 * The backdrop does not follow the theme. In both light and dark, the job of this layer is to
	 * darken what is behind it, and that is done with a shadow rather than a color, as in dialog.tsx.
	 */
	overlay: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
	overlayFill: {
		backgroundColor: SCRIM_COLOR,
		bottom: 0,
		left: 0,
		position: "absolute",
		right: 0,
		top: 0,
	},
	/**
	 * The layer covers the whole screen and the panel sits on the left. This differs from a bottom
	 * sheet by alignment, not justifyContent: the axis this panel contends on is horizontal, not
	 * vertical.
	 */
	content: {
		alignItems: "flex-start",
		bottom: 0,
		flexDirection: "row",
		left: 0,
		position: "absolute",
		right: 0,
		top: 0,
	},
	/**
	 * Only the right corners are rounded. Rounding all four makes a panel pinned to the left edge look
	 * like a floating card. For the same reason the border is on the right only: top, bottom, and left
	 * are off-screen. The shadow falls to the right, the only side with the backdrop behind it.
	 */
	panel: {
		borderBottomRightRadius: radiusScale.xl,
		borderRightWidth: borderWidth,
		borderTopRightRadius: radiusScale.xl,
		elevation: 16,
		height: "100%",
		shadowOffset: { height: 0, width: 8 },
		shadowOpacity: 0.24,
		shadowRadius: 24,
	},
});
