import type { ConversationDisplayMessage } from "@rowcat/chat";
import { space } from "@rowcat/design";
import {
	controlHeight,
	Icon,
	type IconName,
	touchTarget,
} from "@rowcat/ui-native";
import { memo, type ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { AnimatedIconSwap } from "../../../lib/motion/animated-icon-swap.tsx";
import { useCopyMessage } from "./use-copy.ts";

/**
 * Per-message actions: exactly two, copy and the overflow menu.
 *
 * - Web spreads five icons on wide screens and folds to copy + overflow on narrow ones
 *   (`message-action-bar.tsx`); this app has no wide screen. Touch has no hover so this row is
 *   always visible, and five 44pt targets under every message would turn the history into a button
 *   list.
 * - Copy stays outside the menu because it is non-destructive, most frequent, and needs a place
 *   to show the copied state (inside a menu, closing would hide it).
 * - The menu lives in this row: an anchored menu measures its own trigger, so the trigger and
 *   menu are built together by the caller (`useMessageActions.renderMenu`). What to draw stays that
 *   hook's decision.
 * - Height must not change: the copied state swaps only the glyph, since a label or bigger box
 *   would disagree with the virtualizer's measurement and jitter the conversation.
 * - Targets are 44pt but drawn at 36pt; `hitSlop` widens them (as `Button`'s `sm` does). This row
 *   sits under every message, so visible height is conversation density.
 */

/** `(44 - 36) / 2`: the difference between target and visible box, split per side. */
const SLOP = (touchTarget - controlHeight.sm) / 2;

export const MessageActionBar = memo(function MessageActionBar({
	message,
	align,
	menu,
}: {
	message: ConversationDisplayMessage;
	/** Same side as the bubble: user right, assistant left. */
	align: "start" | "end";
	/**
	 * The overflow menu, including its trigger. `null` while the scope is not open yet, leaving only
	 * copy; a trigger that does nothing is not drawn.
	 */
	menu: ReactNode;
}) {
	const copyState = useCopyMessage(message.content);

	return (
		<View style={[bar.root, align === "end" ? bar.alignEnd : bar.alignStart]}>
			<Action
				icon={copyState.state === "copied" ? "check" : "copy"}
				/**
				 * The return from copied to copy is quiet: it is a timer's change, not an answer to a press
				 * (`use-copy-message.ts`), and giving it the entering weight would read as a second success.
				 */
				quiet={copyState.state !== "copied"}
				label={copyState.label}
				onPress={copyState.copy}
			/>
			{menu}
		</View>
	);
});

function Action({
	icon,
	quiet,
	label,
	onPress,
}: {
	icon: IconName;
	quiet: boolean;
	label: string;
	onPress: () => void;
}) {
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			onPress={onPress}
			hitSlop={SLOP}
			style={({ pressed }) => [bar.action, pressed && bar.pressed]}
		>
			{/**
			 * The glyph swaps in place without resizing the box; this row is in a virtualized list, so
			 * a shifting measured height makes scroll jump (`lib/motion/animated-icon-swap.tsx`).
			 */}
			<AnimatedIconSwap stateKey={icon} quiet={quiet}>
				<Icon name={icon} size="md" tone="muted-foreground" />
			</AnimatedIconSwap>
		</Pressable>
	);
}

const bar = StyleSheet.create({
	root: { flexDirection: "row", gap: space.xs },
	alignStart: { justifyContent: "flex-start" },
	alignEnd: { justifyContent: "flex-end" },
	action: {
		alignItems: "center",
		height: controlHeight.sm,
		justifyContent: "center",
		width: controlHeight.sm,
	},
	pressed: { opacity: 0.6 },
});
