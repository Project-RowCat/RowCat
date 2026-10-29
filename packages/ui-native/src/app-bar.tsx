import { borderWidth, space } from "@rowcat/design";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";
import { IconButton } from "./button.tsx";
import { appBarHeight } from "./metrics.ts";
import { Text } from "./text.tsx";
import { useTheme } from "./theme.tsx";

/**
 * Native top bar. It owns only the geometry: which slots exist, what shrinks, and the target sizes.
 * What goes in each slot is decided by the screen and the app shell.
 * - Two leading slots answer different questions. `navigation` (far left, opens the drawer from
 *   AppSidebar) answers 'where can I go from anywhere'. `onBack` answers 'where did I come from'
 *   and goes to the previous screen in this stack. Neither can replace the other. Dropping back
 *   when a drawer exists turns returning from a detail screen into re-picking `Discover`, which grows the
 *   stack. Hiding the drawer on nested screens removes global navigation there.
 * - The title is the only slot that shrinks on narrow screens.
 * - The native stack header stays off, because its platform-colored header ignores this app's
 *   theme. iOS edge-swipe back still works with headerShown false. The back button here is for
 *   Android and for users who do not know the gesture.
 * - The hairline bottom border matches ComposerArea exactly (hairlineWidth * 2 plus border). A
 *   border on one edge only makes the screen look tilted, so the fix lives here, not per screen.
 * - Screens that use this bar place it over scrolling content: `Story details`, `Chats`, `Chats`, `Search chats`,
 *   `Diagnostics`.
 */
export function AppBar({
	title,
	navigation,
	onBack,
	backLabel = "Back",
	leading,
	actions,
}: {
	/**
	 * Current resource. Accepts a node, not only a string, because a brand mark can occupy this slot.
	 * A brand is a logo, not a title.
	 */
	title?: ReactNode;
	/**
	 * Global navigation, at the far left. It sits alongside back and is the reason this slot exists.
	 * Only the shell's trigger (AppSidebar) goes here. Screen actions do not: those go on the right
	 * (`actions`). The far-left end is where a finger expects 'go anywhere in this app'.
	 */
	navigation?: ReactNode;
	onBack?: () => void;
	backLabel?: string;
	/**
	 * Rendered in place of back. Do not combine it with back: both occupy the 'where did I come from'
	 * slot.
	 */
	leading?: ReactNode;
	actions?: ReactNode;
}) {
	const { colors } = useTheme();
	return (
		<View style={[bar.root, { borderBottomColor: colors.border }]}>
			{navigation}
			{onBack ? (
				<IconButton icon="back" label={backLabel} onPress={onBack} />
			) : (
				leading
			)}
			<View style={bar.title}>
				{typeof title === "string" ? (
					<Text accessibilityRole="header" variant="title" numberOfLines={1}>
						{title}
					</Text>
				) : (
					title
				)}
			</View>
			{actions ? <View style={bar.actions}>{actions}</View> : null}
		</View>
	);
}

const bar = StyleSheet.create({
	root: {
		alignItems: "center",
		borderBottomWidth: borderWidth,
		flexDirection: "row",
		/**
		 * With two leading slots the narrowest devices run tight. Lowering the gap from `sm` to `xs` is
		 * the answer. At 320pt, four 44pt targets (drawer, back, search, settings) plus side padding
		 * leave 88pt for the title. At `sm` it is 76pt, about one Korean character less. Do not shrink
		 * the targets to make room. Visible spacing is a matter of taste, but 44pt is the floor
		 * (metrics.ts), and the icons still sit 28pt apart (20pt glyph plus side padding).
		 */
		gap: space.xs,
		/**
		 * Matches the 56pt bar height of the web counterpart. The height belongs to the bar, not to the
		 * buttons inside it (see metrics.ts).
		 */
		minHeight: appBarHeight,
		paddingHorizontal: space.md,
		paddingVertical: space.xs,
	},
	/**
	 * The title takes the remaining width and shrinks, so adding actions does not push it out, and the
	 * actions stay on screen when text is scaled up. `minWidth: 0` is the substance of that. Flex
	 * children default to their content's minimum width, and without it a long title pushes the
	 * right-hand actions off screen. `numberOfLines` truncates but does not shrink. The drawer trigger
	 * used up 44pt of that room.
	 */
	title: { flex: 1, flexShrink: 1, minWidth: 0 },
	actions: {
		alignItems: "center",
		flexDirection: "row",
		flexShrink: 0,
		gap: space.xs,
	},
});
