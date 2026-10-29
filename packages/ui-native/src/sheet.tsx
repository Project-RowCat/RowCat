import * as DialogPrimitive from "@rn-primitives/dialog";
import { borderWidth, radiusScale, space } from "@rowcat/design";
import type { ReactNode } from "react";
import {
	KeyboardAvoidingView,
	ScrollView,
	StyleSheet,
	useWindowDimensions,
	View,
} from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "./icon.tsx";
import { useSoftKeyboardVisible } from "./keyboard.ts";
import { controlHeight, targetSlop } from "./metrics.ts";
import {
	useBackdropStyle,
	useDialogPanelStyle,
	usePrimitivePresence,
} from "./motion/animate.ts";
import { SCRIM_COLOR, ScrimBlur } from "./scrim.tsx";
import { Text } from "./text.tsx";
import { useTheme } from "./theme.tsx";

/**
 * Bottom sheet for short single choices and short action groups, where rising from the bottom
 * helps.
 * - Not for overflow menus (DropdownMenu), single-field forms or read-only details (Dialog),
 *   irreversible confirmations (AlertDialog), long forms or management screens (Dialog size=full),
 *   or searches with long result lists. Current uses: the chat list sort picker
 *   (features/chat-library/library-toolbar.tsx), the report reason picker, and the brightness
 *   shortcut.
 * - Behavior comes from @rn-primitives/dialog, not React Native Modal: aria-modal and dialog
 *   role, the screen reader escape gesture, Android BackHandler, and accessibility focus moved on
 *   open. Modal had none of the first three.
 * - No animation or gesture library is added. @rn-primitives is plain JavaScript and needs no
 *   native rebuild. Reconsider @gorhom/bottom-sheet only when a surface needs drag-to-dismiss or
 *   snap points.
 * - Four ways to close (backdrop tap, Close button, Android back, screen reader escape). Dropping
 *   any one leaves some users without an exit.
 * - The backdrop is hidden from accessibility (accessible={false}); aria-modal and escape already
 *   cover it.
 * - The sheet is portaled outside Screen, so it does not inherit horizontal safe-area insets.
 *   Those are applied here, and bottom padding is handled with KeyboardAvoidingView and
 *   useSoftKeyboardVisible.
 */
/**
 * Upper bound on the screen height a sheet may occupy.
 *
 * The leftover space must show the content behind the sheet. A sheet that covers the whole screen
 * is a screen, and the backdrop tap that dismisses it would disappear.
 */
const PANEL_MAX_HEIGHT_RATIO = 0.86;

export function Sheet({
	title,
	open,
	onOpenChange,
	scroll = false,
	children,
}: {
	title: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/**
	 * Whether the content may be taller than the screen (long forms, long text).
	 *
	 * Off by default because of virtualized lists: a FlatList inside a ScrollView gets unbounded
	 * height and its virtualization turns off. A sheet holding a list must size itself. When this is
	 * off, content cut off by the height cap stays clipped, which shows first on devices with enlarged
	 * font sizes.
	 */
	scroll?: boolean;
	children: ReactNode;
}) {
	const { colors } = useTheme();
	const insets = useSafeAreaInsets();
	const keyboardVisible = useSoftKeyboardVisible();
	/**
	 * Uses the same motion rhythm as Dialog's bottom placement (motion/animate.ts).
	 *
	 * Being a sheet does not justify a bigger motion, such as sliding up from the full screen height.
	 * That would make the surface read as a screen rather than a short single-choice sheet.
	 */
	const presence = usePrimitivePresence(open);
	const backdropStyle = useBackdropStyle(presence);
	const panelStyle = useDialogPanelStyle(presence, true);
	const { height } = useWindowDimensions();

	const body = scroll ? (
		<ScrollView
			keyboardShouldPersistTaps="handled"
			keyboardDismissMode="on-drag"
		>
			{children}
		</ScrollView>
	) : (
		children
	);

	return (
		<DialogPrimitive.Root
			open={presence.mounted}
			onOpenChange={(next) => {
				if (next !== open) onOpenChange(next);
			}}
		>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay style={sheet.overlay}>
					<Animated.View style={[sheet.overlayFill, backdropStyle]}>
						<ScrimBlur />
					</Animated.View>
				</DialogPrimitive.Overlay>
				<DialogPrimitive.Content style={sheet.content}>
					{/**
					 * Measures the sheet's own frame and moves only by the amount it overlaps the keyboard.
					 *
					 * On deployments where the window resizes, that overlap converges to 0, so the offset must not be
					 * applied
					 * twice (same rule as in screen.tsx).
					 */}
					<KeyboardAvoidingView behavior="padding">
						<Animated.View
							style={[
								panelStyle,
								sheet.panel,
								{
									backgroundColor: colors.popover,
									borderTopColor: colors.border,
									maxHeight: height * PANEL_MAX_HEIGHT_RATIO,
									paddingLeft: space.lg + insets.left,
									paddingRight: space.lg + insets.right,
									/**
									 * Zero while the on-screen keyboard is up. The keyboard already covers that space, so
									 * padding would leave an empty band between the sheet and the keyboard. With a hardware
									 * keyboard the padding stays.
									 */
									paddingBottom:
										space.sm + (keyboardVisible ? 0 : insets.bottom),
								},
							]}
						>
							<View style={sheet.head}>
								{/**
								 * `role="heading"` is set by Title, and the primitive uses it as the dialog's accessible name.
								 * The first thing a screen reader announces when the sheet opens is this title.
								 */}
								<DialogPrimitive.Title asChild>
									<Text
										variant="label"
										tone="muted-foreground"
										style={sheet.title}
									>
										{title}
									</Text>
								</DialogPrimitive.Title>
								<DialogPrimitive.Close
									accessibilityLabel="Close"
									hitSlop={targetSlop(controlHeight.md)}
									style={sheet.close}
								>
									<Icon name="close" size="lg" tone="muted-foreground" />
								</DialogPrimitive.Close>
							</View>
							{body}
						</Animated.View>
					</KeyboardAvoidingView>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}

const sheet = StyleSheet.create({
	/**
	 * The backdrop ignores the theme. In light and dark mode alike, its job is to darken what is
	 * behind it. That effect is a shade, not a theme color.
	 *
	 * The PortalOutlet that Portal mounts into is outside normal layout flow, so its geometry is set
	 * here. The primitive does not position content; that is the Radix-style primitive contract.
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
	/** Content sits flush with the bottom edge, where a thumb reaches most easily. */
	content: { bottom: 0, left: 0, position: "absolute", right: 0 },
	/**
	 * Horizontal and bottom padding are applied inline, because they depend on both the safe area and
	 * the keyboard state.
	 */
	panel: {
		borderTopLeftRadius: radiusScale.xl,
		borderTopRightRadius: radiusScale.xl,
		borderTopWidth: borderWidth,
		paddingTop: space.md,
	},
	head: { alignItems: "center", flexDirection: "row", gap: space.sm },
	title: { flex: 1 },
	close: {
		alignItems: "center",
		height: controlHeight.md,
		justifyContent: "center",
		/**
		 * The close glyph sits flush with the right edge (negative margin), where a finger finds it most
		 * easily.
		 */
		marginRight: -space.sm,
		width: controlHeight.md,
	},
});
