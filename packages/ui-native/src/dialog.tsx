import * as DialogPrimitive from "@rn-primitives/dialog";
import { borderWidth, radiusScale, space } from "@rowcat/design";
import { Children, cloneElement, isValidElement, type ReactNode } from "react";
import {
	KeyboardAvoidingView,
	ScrollView,
	StyleSheet,
	useWindowDimensions,
	View,
} from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { IconButton } from "./button.tsx";
import {
	type DialogPlacement,
	resolveDialogPlacement,
} from "./dialog-placement.ts";
import { useSoftKeyboardVisible } from "./keyboard.ts";
import {
	useBackdropStyle,
	useDialogPanelStyle,
	usePrimitivePresence,
} from "./motion/animate.ts";
import { SCRIM_COLOR, ScrimBlur } from "./scrim.tsx";
import { Text } from "./text.tsx";
import { useTheme } from "./theme.tsx";

/**
 * Modal dialog: the native counterpart of the web Dialog, not an alias of the sheet.
 * - Size and placement are separate axes: compact or full, crossed with center, bottom or
 *   adaptive.
 * - Other interactions have their own components: ChoiceSheet, DropdownMenu, AlertDialog. The
 *   full table is in docs/design/ARCHITECTURE.md.
 * - full is not a separate route. These surfaces belong to the current conversation and should
 *   not leave history entries that outlive it.
 * - compact that nearly fills the screen is the wrong choice; the call site decides from device
 *   geometry.
 * - Behavior (role, aria-modal, Android back, screen-reader escape, focus) comes from
 *   @rn-primitives/dialog and fails silently if wrong.
 * - Four ways to close: backdrop tap, close button, Android back, screen-reader escape. full has
 *   no backdrop, so its close button is required.
 * - The content layer uses box-none so taps outside the box still reach the backdrop.
 */

/**
 * Caps the box width on wide devices (tablets) so it does not stretch without limit. This is
 * slightly narrower than the web's sm:max-w-md (448px), because a line on a hand-held screen should
 * stay short.
 */
const COMPACT_MAX_WIDTH = 420;

/**
 * Upper bound on the screen height that compact may take. The space left over must stay visible so
 * the screen behind shows. A centered box that fills the screen is a screen; use size=full for
 * that.
 */
const COMPACT_MAX_HEIGHT_RATIO = 0.82;

/**
 * Upper bound on the height that bottom may take. The web uses max-h-[85dvh] for the same reason:
 * the space above is where the screen behind shows and where a backdrop tap closes it. It is a bit
 * more generous than the centered box, because a bottom panel only grows upward while a centered
 * box grows in both directions.
 */
const BOTTOM_MAX_HEIGHT_RATIO = 0.85;

export function Dialog({
	title,
	description,
	open,
	onOpenChange,
	onBack,
	backLabel = "Back",
	size = "compact",
	placement = "center",
	headerDivider = false,
	scroll = false,
	bodyKey,
	children,
}: {
	/** The dialog's accessible name. Screen readers read it first when the dialog opens. */
	title: string;
	/** A line under the title. Use it only when the title alone does not say what the window does. */
	description?: string;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/**
	 * Goes back one screen inside this dialog. This is distinct from closing. Exists for windows with
	 * several screens of their own, such as conversation settings home and detail. Those screens are
	 * not stacked as two dialogs: two layers mean two focus owners and an unpredictable Android back
	 * target. Not passing it renders nothing. A disabled back arrow is worse than none, because a
	 * visible back button on the first screen suggests there is somewhere to go.
	 */
	onBack?: () => void;
	/**
	 * Accessible name of the back button. A one-arrow button without a name reads as just 'button' to
	 * screen readers. This window also has a close button, so the two would not be told apart. Naming
	 * the destination is better still.
	 */
	backLabel?: string;
	size?: "compact" | "full";
	/**
	 * The placement of this window, a separate axis from size (see dialog-placement.ts). Default is
	 * center, so windows that are centered now (`Rename`, `Edit message`) do not change geometry without an
	 * audit. Which windows should dock is a product decision for each window; opting in keeps it
	 * visible at the call site. Ignored when size is full, since full fills the screen and has only
	 * one place.
	 */
	placement?: DialogPlacement;
	/**
	 * Draws a line between the header and the body. It only has an effect in windows whose body
	 * scrolls: there the line marks 'top is fixed, bottom moves'. On a window that does not scroll
	 * (rename), it would split a short form into two sections for no reason. The line extends to the
	 * outer edge of the padding, so it reads as the header's boundary rather than a list divider.
	 */
	headerDivider?: boolean;
	/**
	 * Whether the content may exceed the size limit. When unset, size decides: full scrolls. The
	 * default is derived because of virtualized lists. A FlatList inside a ScrollView gets infinite
	 * height from the outside, which turns virtualization off. Otherwise, content over the limit is
	 * cut off, and that shows first on devices with large text settings. It can be turned off
	 * explicitly even for full. full used to always scroll, which was right while its content was only
	 * forms and lists. A child that takes its height from the parent and scrolls itself (a webview or
	 * virtual list) breaks that: under an outer scroll it gets infinite height and renders at zero,
	 * silently. It is opt-in because flipping the default would truncate the long forms of every full
	 * window today: `Report`, `Memory`, `Connect provider`, `Delete account`, `Test conditions`.
	 */
	scroll?: boolean;
	/**
	 * When this value changes, the scroll position restarts at the top. Used only when one window has
	 * several screens. There is one scroll view and the screens swap inside it. Without a reset, going
	 * back from a detail scrolled down would draw the first screen mid-scroll, so the list looks cut
	 * off. A key is used instead of a scrollTo ref so that no imperative handle leaks out; such a
	 * handle would start being treated as product state by callers.
	 */
	bodyKey?: string;
	children: ReactNode;
}) {
	const { colors } = useTheme();
	const insets = useSafeAreaInsets();
	const keyboardVisible = useSoftKeyboardVisible();
	const { height, width } = useWindowDimensions();
	const full = size === "full";
	/**
	 * A full dialog ignores placement, since it fills the screen and has only one place. The decision
	 * is made by the pure resolver; this line only applies its answer as style.
	 */
	const bottom = !full && resolveDialogPlacement(placement, width) === "bottom";

	/**
	 * Horizontal padding. Only bottom-docked and full dialogs add the safe-area inset. A centered box
	 * has a capped width and cannot reach a notch cutout, since maxWidth already subtracts the safe
	 * area. The other two extend to the device edges, so on a notched device in landscape the text
	 * would fall under the cutout without this inset.
	 */
	const edge = full || bottom;
	/**
	 * The padding is the web's p-6 (24), and all three placements (centered, bottom, full) use it. The
	 * compact panel already noted the same fact, but that fix had only reached the centered box. At
	 * 16, bottom and full dialogs were 8pt narrower on each side than on the web. Each looks plausible
	 * alone; the difference only shows side by side.
	 */
	const padLeft = space.xl + (edge ? insets.left : 0);
	const padRight = space.xl + (edge ? insets.right : 0);

	/**
	 * Keeps the content rendered until the closing animation finishes. The primitive receives this
	 * presence value, but the caller's source of truth remains its own open prop (see the header of
	 * motion/animate.ts). Open and close product state does not wait for the transition.
	 */
	const presence = usePrimitivePresence(open);
	const backdropStyle = useBackdropStyle(presence);
	const panelStyle = useDialogPanelStyle(presence, bottom);

	/**
	 * Uses ?? rather than ||, so that scroll={false} is respected rather than replaced by full's
	 * default.
	 */
	const scrolls = scroll ?? full;
	const body = scrolls ? (
		<ScrollView
			key={bodyKey}
			keyboardShouldPersistTaps="handled"
			keyboardDismissMode="on-drag"
			/**
			 * flexShrink: 1 is required. Without it, scrolling is off entirely: the ScrollView's default
			 * style has no flex, so its height grows to the content, and the box's maxHeight clips it
			 * instead of making it scroll. The symptom is that the bottom of long content disappears; short
			 * sample text will not show it.
			 */
			style={dialog.scroll}
			contentContainerStyle={[
				dialog.scrollContent,
				/** When the header divider is on, the body needs space below the line. */
				headerDivider && dialog.scrollContentDivided,
			]}
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
				/**
				 * Close requests from the primitive (backdrop tap, back, escape) pass through to the caller
				 * unchanged. During the exit animation mounted and open differ, so onOpenChange is called only
				 * when the value actually changes. That avoids sending the same signal twice (same wiring as
				 * navigation-drawer.tsx).
				 */
				if (next !== open) onOpenChange(next);
			}}
		>
			<DialogPrimitive.Portal>
				<DialogPrimitive.Overlay style={dialog.overlay}>
					{/**
					 * The background color lives inside this inner layer. The primitive's Overlay is a Pressable and
					 * cannot
					 * take animated style directly. Switching to asChild with Slot would also lose the press handling
					 * on this
					 * layer (see the same spot in navigation-drawer.tsx).
					 */}
					<Animated.View style={[dialog.overlayFill, backdropStyle]}>
						<ScrimBlur />
					</Animated.View>
				</DialogPrimitive.Overlay>
				<DialogPrimitive.Content
					pointerEvents="box-none"
					style={dialog.content}
				>
					{/**
					 * Measures its own frame and pushes only by the amount that overlaps. In deployments where the
					 * window
					 * resizes, that amount converges to zero, so the layer never pushes twice (same rule as
					 * screen.tsx).
					 */}
					<KeyboardAvoidingView
						behavior="padding"
						pointerEvents="box-none"
						style={[dialog.avoider, bottom && dialog.avoiderBottom]}
					>
						<Animated.View
							style={[
								panelStyle,
								full
									? dialog.panelFull
									: bottom
										? dialog.panelBottom
										: dialog.panelCompact,
								{
									backgroundColor: colors.popover,
									borderColor: colors.border,
								},
								full
									? {
											paddingLeft: padLeft,
											paddingRight: padRight,
											paddingTop: space.md + insets.top,
											paddingBottom:
												space.lg + (keyboardVisible ? 0 : insets.bottom),
										}
									: bottom
										? {
												maxHeight: height * BOTTOM_MAX_HEIGHT_RATIO,
												paddingLeft: padLeft,
												paddingRight: padRight,
												/**
												 * The panel extends to the device's bottom edge; only the padding respects the safe
												 * area. If the background stopped above the home indicator, the screen behind would
												 * show underneath and the panel would read as a floating card instead of one docked to
												 * the bottom (same rule as sheet.tsx). The padding is zero when the keyboard is up,
												 * because the keyboard covers that area.
												 */
												paddingBottom:
													space.lg + (keyboardVisible ? 0 : insets.bottom),
											}
										: {
												maxHeight: height * COMPACT_MAX_HEIGHT_RATIO,
												maxWidth: Math.min(
													COMPACT_MAX_WIDTH,
													width - insets.left - insets.right - space.lg * 2,
												),
											},
							]}
						>
							<View
								style={[
									dialog.head,
									headerDivider && [
										dialog.headDivided,
										{
											borderBottomColor: colors.border,
											/**
											 * The divider must reach the outer edge of the padding to read as the header boundary.
											 * Horizontal padding differs by placement (bottom-docked adds the safe area), so the
											 * negative margin is set to exactly that value.
											 */
											marginLeft: -padLeft,
											marginRight: -padRight,
											paddingLeft: padLeft,
											paddingRight: padRight,
										},
									],
								]}
							>
								{/**
								 * Back is to the left of the title. Close sits at the right end, so the two controls are at
								 * opposite ends
								 * of the window, and fingers learn that position.
								 */}
								{onBack ? (
									<IconButton
										icon="back"
										label={backLabel}
										tone="muted-foreground"
										onPress={onBack}
									/>
								) : null}
								<View style={dialog.heading}>
									{/**
									 * Title and description are rendered by our Text, not by DialogPrimitive.Title or Description.
									 * - In this version of @rn-primitives/dialog (1.5.x), those ignore asChild and always render React
									 * Native's
									 * Text. Passing asChild nests our Text inside it, and React Native reads numberOfLines only from
									 * the
									 *   root text node, so the inner line limit is ignored.
									 * - The style still looks right, so the bug shows only with a long title. A 64-character work title
									 * pushed the header to two lines and shifted the content below. The web's same spot uses truncate
									 * and
									 *   is always one line.
									 * - The cost is losing role=heading from Title; that is set directly below.
									 * - The primitive's Content does not link the title to the dialog's name by id. The window's name
									 * comes
									 *   from role=dialog together with the title inside it.
									 */}
									{/**
									 * The web DialogTitle is leading-none font-medium inside a text-sm box, so it is 14/500: a
									 * body-size
									 * line that is slightly bold, not a large title. This line used to be the title style (17/600),
									 * which made
									 * the same window look much heavier in the app.
									 * Do not truncate; the web has no truncate at this spot.
									 */}
									<Text
										accessibilityRole="header"
										variant="body"
										weight="medium"
									>
										{title}
									</Text>
									{description ? (
										/**
										 * Warning: this line once had numberOfLines={1}, justified by 'the web's same spot uses
										 * truncate'. The web's DialogDescription has no such class; measured, it wraps to two
										 * lines. The one-line limit cut off the end of the description in the app, and that
										 * trailing clause usually says what the window does. Keep it unlimited.
										 */
										<Text variant="body" tone="muted-foreground">
											{description}
										</Text>
									) : null}
								</View>
								{/**
								 * The primitive's Close is not wrapped in asChild. Slot passes only onPress, and our IconButton
								 * does not
								 * spread arbitrary props (a rule of this package). The effect is the same, so this closes directly.
								 */}
								<IconButton
									icon="close"
									label="Close"
									tone="muted-foreground"
									onPress={() => onOpenChange(false)}
								/>
							</View>
							{body}
						</Animated.View>
					</KeyboardAvoidingView>
				</DialogPrimitive.Content>
			</DialogPrimitive.Portal>
		</DialogPrimitive.Root>
	);
}

/**
 * The dialog's bottom action row: cancel on the left, confirm on the right, the same order as the
 * web's DialogFooter. If each screen wrote its own order, one screen would eventually flip it.
 * Since fingers remember position, users would press cancel only on that screen.
 */
/**
 * The window's bottom action row fills the full width. On narrow web screens the matching area is
 * flex-col-reverse, and its default align-items: stretch makes buttons span the window (a 390pt
 * measurement gives 310pt per button). alignItems: stretch alone does not achieve that here. Button
 * always sets its own alignSelf (hug or fullWidth), and alignSelf overrides the parent's
 * alignItems, the same wall met when EmptyState centers its actions. So this container passes the
 * stretch decision to its children. The 23 call sites do not set fullWidth by hand: a future window
 * author who forgets that line would get the old look silently. A child that has already set a
 * value is respected; the container does not overwrite it.
 */
export function DialogActions({ children }: { children: ReactNode }) {
	return (
		<View style={dialog.actions}>
			{Children.map(children, (child) =>
				isValidElement<{ fullWidth?: boolean }>(child)
					? cloneElement(child, { fullWidth: child.props.fullWidth ?? true })
					: child,
			)}
		</View>
	);
}

const dialog = StyleSheet.create({
	/**
	 * The backdrop does not follow the theme. In both light and dark mode, this layer's job is to
	 * darken what is behind it, and that is a shadow, not a color.
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
	 * The layer covers the whole screen. Where the panel sits is decided by the avoider below. The
	 * default is centered (justifyContent: center), and only the bottom placement changes that line.
	 * Only geometry changes, so the distinction from the sheet stays in the vessel (see
	 * dialog-placement.ts).
	 */
	content: {
		alignItems: "center",
		bottom: 0,
		justifyContent: "center",
		left: 0,
		position: "absolute",
		right: 0,
		top: 0,
	},
	avoider: {
		alignItems: "center",
		flex: 1,
		justifyContent: "center",
		width: "100%",
	},
	/**
	 * For bottom placement. The keyboard-avoidance layer measures its own frame and pushes, so
	 * changing only flex-end here makes the panel's bottom sit exactly on the keyboard's top edge when
	 * the keyboard is up.
	 */
	avoiderBottom: { justifyContent: "flex-end" },
	panelCompact: {
		borderRadius: radiusScale.xl,
		borderWidth: borderWidth,
		/** Android shadow via elevation. iOS uses the shadow properties below. */
		elevation: 12,
		paddingBottom: space.xl,
		paddingHorizontal: space.xl,
		paddingTop: space.xl,
		/**
		 * shadowColor is not set. The default is black, and choosing a color here would add one outside
		 * this package's tokens. A shadow is the absence of light, not a theme color.
		 */
		shadowOffset: { height: 8, width: 0 },
		shadowOpacity: 0.24,
		shadowRadius: 24,
		width: "100%",
	},
	/**
	 * Bottom-docked panel: the top corners are rounded and the bottom corners are square. Four rounded
	 * corners make the panel read as a floating card, even when it is flush with the device bottom.
	 * The border is top-only for the same reason: the left, right and bottom edges are off-screen, so
	 * there is no edge to draw. The shadow goes upward (height -8), because only the area above the
	 * panel shows the screen behind.
	 */
	panelBottom: {
		borderTopLeftRadius: radiusScale.xl,
		borderTopRightRadius: radiusScale.xl,
		borderTopWidth: borderWidth,
		elevation: 12,
		paddingTop: space.xl,
		shadowOffset: { height: -8, width: 0 },
		shadowOpacity: 0.24,
		shadowRadius: 24,
		width: "100%",
	},
	panelFull: { flex: 1, width: "100%" },
	/**
	 * The gap between the head and the body is the web's gap-6 (24). It was 12, which made the same
	 * window tighter in the app than on the web: title, description, body and actions read as one
	 * block.
	 */
	head: {
		alignItems: "flex-start",
		flexDirection: "row",
		gap: space.sm,
		paddingBottom: space.xl,
	},
	headDivided: { borderBottomWidth: borderWidth },
	heading: { flex: 1, gap: space.xs },
	scroll: { flexShrink: 1 },
	scrollContent: { paddingBottom: space.sm },
	scrollContentDivided: { paddingTop: space.md },
	/**
	 * Actions stack vertically with the confirm button on top, matching the web's flex-col-reverse
	 * gap-2 on narrow screens. The web's horizontal row starts at the sm breakpoint (640px), which
	 * this app has no width for. It was a horizontal row before, which left two short buttons bunched
	 * on the left of the window.
	 */
	actions: {
		flexDirection: "column-reverse",
		gap: space.sm,
		paddingTop: space.xl,
	},
});
