import * as MenuPrimitive from "@rn-primitives/dropdown-menu";
import { borderWidth, iconSize, radiusScale, space } from "@rowcat/design";
import type { ReactNode } from "react";
import { StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, { LayoutAnimationConfig } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, type IconName } from "./icon.tsx";
import { controlHeight, targetSlop } from "./metrics.ts";
import { menuIndicatorEnter, popupEnter } from "./motion/animate.ts";
import { useSelectionFeedback } from "./selection-feedback.tsx";
import { Text } from "./text.tsx";
import { useTheme } from "./theme.tsx";

/**
 * Action menu anchored to its trigger: the native counterpart of web's DropdownMenu.
 *
 * Why this is not a sheet. The app used to open a bottom sheet for every overflow button. A sheet
 * is the wrong container for a small context menu:
 * - Position: a finger that pressed the trailing end of a header row travels down to the bottom
 *   of the screen, and the context is lost.
 * - Size: five 52pt rows fill the screen width, so five actions turn into a whole screen.
 * - Meaning: a sheet means "cover this screen". A menu means "act on the thing just pressed".
 *
 * The decision is made by the nature of the interaction, not by platform. The table is in the
 * presentation section of docs/design/ARCHITECTURE.md. This file is one row of it: a short action
 * group tied to a trigger.
 *
 * The primitive, @rn-primitives/dropdown-menu, owns the behavior:
 * - Trigger measurement and collision avoidance (measure() plus useRelativePosition, which takes
 *   insets and flips or clamps the menu).
 * - role="menu" and menuitem roles for assistive tech.
 * - Focus: moves into the menu on open and back to the trigger on close.
 * - Closing: backdrop tap, Android back, screen reader escape, and item selection.
 *
 * No animation or gesture library is added. The package is pure JavaScript and needs no native
 * rebuild, and boundaries.test.ts enforces that.
 */

/**
 * Menu row height: 32, the same as web's DropdownMenuItem (px-2 py-1.5 text-sm).
 *
 * It was 44 for a while, on the reasoning that adjacent rows cannot take hitSlop. That is still
 * true, so this row has no slack, but it no longer justifies a taller visible row. The same menu
 * being 37% taller in the app than on the web makes it read as a different control, and the web
 * product already shows 32px rows at the same width.
 *
 * The row gives up one axis, not the whole area. It spans the full menu width (minimum 128), so
 * only its height is below the 44pt floor.
 */
const ITEM_HEIGHT = controlHeight.sm;

/**
 * Caps the menu width below full screen. This much space must stay visible on each side, so the
 * content behind the menu shows.
 */
const VIEWPORT_MARGIN = space.xl;

/**
 * Floor for the menu width, so the shortest item does not look like a fragment. Same as web's
 * min-w-32 (128).
 */
const MIN_WIDTH = 128;

export function DropdownMenu({
	label,
	icon = "more",
	align = "end",
	tone = "foreground",
	size = "md",
	selected,
	triggerLabel,
	children,
}: {
	/**
	 * Accessible name of the trigger. It is not visible but always required. An icon-only trigger
	 * would be read only as "button".
	 */
	label: string;
	icon?: IconName;
	/**
	 * Edge the menu aligns to, like message bubbles: own messages use end, replies use start. If there
	 * is no room, the primitive folds to the opposite side (avoidCollisions).
	 */
	align?: "start" | "center" | "end";
	tone?: "foreground" | "muted-foreground";
	/**
	 * Trigger size. sm is for places such as chat rows that sit under every message. There, hitSlop
	 * widens the target to 44. Visible size and target size are separate axes.
	 */
	size?: "sm" | "md";
	/**
	 * Whether the trigger's subject is the current screen, for example an account menu while already
	 * at its destination. Color alone would drop that state for people who cannot distinguish colors,
	 * so when set, it is also exposed as accessibility state.
	 *
	 * If not passed (most menus), no state is sent. "Not selected" is not invented.
	 */
	selected?: boolean;
	/**
	 * Puts text on the trigger, as web's DropdownMenuTrigger render={<Button>} does. For example, the
	 * `Filter` and `Newest` triggers on the discovery screen.
	 *
	 * It takes a string, not a node. A node would let the caller set the trigger's surface and size,
	 * and two triggers on the same row would end up with different boxes. This is the same axis as the
	 * reason the package exports no general container (see index.ts).
	 *
	 * Without it, the trigger shows only an icon.
	 */
	triggerLabel?: string;
	children: ReactNode;
}) {
	const { colors, outlineSurface } = useTheme();
	const insets = useSafeAreaInsets();
	const { width } = useWindowDimensions();

	const labelled = triggerLabel !== undefined;
	const box = size === "sm" ? controlHeight.sm : controlHeight.md;

	return (
		<MenuPrimitive.Root>
			<MenuPrimitive.Trigger
				accessibilityLabel={label}
				accessibilityState={selected === undefined ? undefined : { selected }}
				hitSlop={targetSlop(labelled ? controlHeight.lg : box)}
				style={({ pressed }) => [
					labelled ? menu.labelledTrigger : menu.trigger,
					labelled
						? /** A trigger with a label uses the same surface as the outline button. */
							{ backgroundColor: outlineSurface, borderColor: colors.border }
						: { height: box, width: box },
					pressed && menu.pressed,
				]}
			>
				{labelled ? (
					<>
						{/**
						 * Icon comes first and the chevron last, the same order as web's filter trigger. The chevron says
						 * that
						 * a list exists, so it always comes last.
						 */}
						{icon !== "chevron-down" ? (
							<Icon name={icon} size="md" tone={tone} />
						) : null}
						<Text variant="label" weight="medium" numberOfLines={1}>
							{triggerLabel}
						</Text>
						<Icon name="chevron-down" size="md" tone="muted-foreground" />
					</>
				) : (
					<Icon name={icon} size={size === "sm" ? "md" : "lg"} tone={tone} />
				)}
			</MenuPrimitive.Trigger>
			<MenuPrimitive.Portal>
				{/**
				 * The backdrop is hidden from the accessibility tree (the primitive sets accessible to false). A
				 * full-screen close button in the tree would be noise, since the escape gesture already closes the
				 * menu.
				 *
				 * No color. The menu does not dim the background, because dimming would make it read as a sheet.
				 * This
				 * layer only receives outside taps.
				 */}
				<MenuPrimitive.Overlay style={menu.overlay} />
				<MenuPrimitive.Content
					align={align}
					sideOffset={space.xs}
					insets={{
						top: insets.top + VIEWPORT_MARGIN,
						bottom: insets.bottom + VIEWPORT_MARGIN,
						left: insets.left + space.md,
						right: insets.right + space.md,
					}}
					/**
					 * An object, not an array. The style merges with positioning results, and the primitive
					 * accepts a single ViewStyle.
					 */
					style={{
						...menu.content,
						backgroundColor: colors.popover,
						maxWidth: width - insets.left - insets.right - VIEWPORT_MARGIN * 2,
					}}
				>
					{/**
					 * The inner layer is the one that animates. The primitive's Content merges its positioning result
					 * into
					 * its own style, so an animated style on that element would fight the calculation every frame. Only
					 * transform and opacity change here, not the measured size.
					 */}
					{/*
					 * Only the panel itself enters. If checked rows also entered, a check that was not just pressed
					 * would pop in on every open, which looks like a fresh change.
					 *
					 * skipEntering only skips the children of the commit where this layer mounts. Reanimated clears
					 * that
					 * marker in the next effect, so a check pressed after opening enters normally. Web reaches the same
					 * answer because Base UI mounts without a starting state.
					 */}
					<Animated.View entering={popupEnter}>
						<LayoutAnimationConfig skipEntering>
							{children}
						</LayoutAnimationConfig>
					</Animated.View>
					{/**
					 * The ring sits outside layout, like web's ring-1. Card uses the same approach (surface.tsx). When
					 * this used a borderWidth, the same menu measured 98 in the app against 100 on the web.
					 *
					 * The ring must share the content's entrance. Being outside the flow it does not fight positioning,
					 * and if it stayed static the ring would appear before the content.
					 */}
					<Animated.View
						entering={popupEnter}
						pointerEvents="none"
						style={[menu.ring, { borderColor: colors.border }]}
					/>
				</MenuPrimitive.Content>
			</MenuPrimitive.Portal>
		</MenuPrimitive.Root>
	);
}

/**
 * A row in the menu: one icon, one label.
 *
 * A destructive item only changes color. The real guard is the confirmation AlertDialog that
 * follows. Red text stops nothing, and to someone who cannot distinguish colors, the row looks
 * plain.
 *
 * A disabled item must be disabled for real. Checking `if (disabled) return` inside onSelect is not
 * enough. The row still looks normal, assistive tech reads it as a normal menuitem, and when
 * touched the menu closes with nothing happening, so the user cannot tell what went wrong. The
 * primitive's disabled prop fixes all three at once: Pressable ignores touches, so closeOnPress
 * does not run, and accessibilityState.disabled announces the state.
 *
 * Dimming and color follow the same convention as SelectOption (select.tsx). Two menu rows locked
 * in different styles on the same primitive would leave no way to tell which one is canonical.
 */
export function MenuItem({
	icon,
	label,
	destructive,
	disabled,
	onSelect,
}: {
	icon: IconName;
	label: string;
	destructive?: boolean;
	disabled?: boolean;
	/**
	 * Pressing closes the menu first, then this function runs (the primitive's closeOnPress). A dialog
	 * opened here never sits on top of a still-open menu. Two open layers would give accessibility
	 * focus two owners, and Android back would close an unpredictable one.
	 */
	onSelect: () => void;
}) {
	const { colors } = useTheme();
	/**
	 * A locked destructive row is not red. A warning color on an action that cannot happen loses its
	 * meaning, and it would also weaken the red shown when the action is enabled.
	 */
	const tone = disabled
		? "muted-foreground"
		: destructive
			? "destructive"
			: "popover-foreground";

	return (
		<MenuPrimitive.Item
			textValue={label}
			disabled={disabled}
			onPress={onSelect}
			style={({ pressed }) => [
				menu.item,
				disabled && menu.disabled,
				pressed &&
					!disabled && {
						backgroundColor: destructive ? colors.muted : colors.accent,
					},
			]}
		>
			<Icon name={icon} size="md" tone={tone} />
			<Text variant="body" tone={tone} style={menu.itemLabel}>
				{label}
			</Text>
		</MenuPrimitive.Item>
	);
}

/**
 * Group name inside the menu (web DropdownMenuLabel). It appears only when the menu chooses along
 * two or more axes. With one axis, the trigger's name already says it.
 */
export function MenuLabel({ label }: { label: string }) {
	return (
		<MenuPrimitive.Label style={menu.groupLabel}>
			<Text variant="caption" tone="muted-foreground">
				{label}
			</Text>
		</MenuPrimitive.Label>
	);
}

/**
 * A group of single-choice rows (web DropdownMenuRadioGroup). The primitive wires role="radiogroup"
 * and the "item n of m" position. Radio rows without a group would be read by assistive tech as
 * unrelated checkboxes.
 */
export function MenuRadioGroup({
	value,
	onValueChange,
	children,
}: {
	value: string;
	onValueChange: (value: string) => void;
	children: ReactNode;
}) {
	const feedback = useSelectionFeedback();
	return (
		<MenuPrimitive.RadioGroup
			value={value}
			onValueChange={(next) => {
				if (next !== value) feedback();
				onValueChange(next);
			}}
		>
			{children}
		</MenuPrimitive.RadioGroup>
	);
}

/**
 * A single-choice row (web DropdownMenuRadioItem).
 *
 * Pressing it does not close the menu (closeOnPress is false). The point is to let the user set two
 * conditions in a row without reopening the menu. Web's item does this through the primitive's
 * default. The difference only shows when a second axis is being chosen.
 */
export function MenuRadioItem({
	value,
	label,
	disabled,
}: {
	value: string;
	label: string;
	disabled?: boolean;
}) {
	const { colors } = useTheme();
	return (
		<MenuPrimitive.RadioItem
			value={value}
			textValue={label}
			disabled={disabled}
			closeOnPress={false}
			style={({ pressed }) => [
				menu.item,
				menu.choiceItem,
				disabled && menu.disabled,
				pressed && !disabled && { backgroundColor: colors.accent },
			]}
		>
			<Text
				variant="body"
				tone={disabled ? "muted-foreground" : "popover-foreground"}
				style={menu.itemLabel}
			>
				{label}
			</Text>
			<View pointerEvents="none" style={menu.indicator}>
				<MenuPrimitive.ItemIndicator>
					<Animated.View entering={menuIndicatorEnter}>
						<Icon name="check" size="md" tone="popover-foreground" />
					</Animated.View>
				</MenuPrimitive.ItemIndicator>
			</View>
		</MenuPrimitive.RadioItem>
	);
}

/**
 * A toggle row (web DropdownMenuCheckboxItem). It is kept separate from radio rows because
 * assistive tech announces different roles: selected versus checked. The picture is the same; the
 * meaning is not.
 */
export function MenuCheckboxItem({
	label,
	checked,
	onCheckedChange,
	disabled,
}: {
	label: string;
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
	disabled?: boolean;
}) {
	const { colors } = useTheme();
	return (
		<MenuPrimitive.CheckboxItem
			checked={checked}
			onCheckedChange={onCheckedChange}
			textValue={label}
			disabled={disabled}
			closeOnPress={false}
			style={({ pressed }) => [
				menu.item,
				menu.choiceItem,
				disabled && menu.disabled,
				pressed && !disabled && { backgroundColor: colors.accent },
			]}
		>
			<Text
				variant="body"
				tone={disabled ? "muted-foreground" : "popover-foreground"}
				style={menu.itemLabel}
			>
				{label}
			</Text>
			<View pointerEvents="none" style={menu.indicator}>
				<MenuPrimitive.ItemIndicator>
					<Animated.View entering={menuIndicatorEnter}>
						<Icon name="check" size="md" tone="popover-foreground" />
					</Animated.View>
				</MenuPrimitive.ItemIndicator>
			</View>
		</MenuPrimitive.CheckboxItem>
	);
}

/**
 * Separator. It keeps destructive items away from where a finger sliding across the list would
 * land.
 */
export function MenuSeparator() {
	const { colors } = useTheme();
	return (
		<MenuPrimitive.Separator
			decorative
			style={[menu.separator, { backgroundColor: colors.border }]}
		/>
	);
}

const menu = StyleSheet.create({
	trigger: { alignItems: "center", justifyContent: "center" },
	/**
	 * Trigger that carries a label. Same surface as web's toolbar button (outline, size sm; h-10 px-3
	 * on narrow screens). Two of these sit on the same row, so the box is fixed here.
	 */
	labelledTrigger: {
		alignItems: "center",
		borderRadius: radiusScale.md,
		borderWidth: borderWidth,
		flexDirection: "row",
		gap: space.xs + 2,
		justifyContent: "center",
		minHeight: controlHeight.lg,
		paddingHorizontal: space.md,
	},
	pressed: { opacity: 0.6 },
	/**
	 * The overlay covers the full screen. The Portal mount point (PortalOutlet) gets its geometry
	 * here, rather than from the flow. The primitive promises not to choose a position itself (Radix
	 * style).
	 */
	overlay: {
		bottom: 0,
		left: 0,
		position: "absolute",
		right: 0,
		top: 0,
	},
	content: {
		borderRadius: radiusScale.md,
		elevation: 8,
		minWidth: MIN_WIDTH,
		padding: space.xs,
		/**
		 * shadowColor is not set, so the default black applies. Picking a color here would add a color
		 * outside the token set. A shadow is the absence of light, not a theme color.
		 */
		shadowOffset: { height: 4, width: 0 },
		shadowOpacity: 0.18,
		shadowRadius: 12,
	},
	item: {
		alignItems: "center",
		borderRadius: radiusScale.sm,
		flexDirection: "row",
		gap: space.sm,
		minHeight: ITEM_HEIGHT,
		paddingHorizontal: space.sm,
	},
	/**
	 * flexShrink 1, not flex 1, because the menu's width comes from its content.
	 *
	 * flex 1 also sets flexBasis 0, so labels contribute nothing to the box's intrinsic width. The
	 * floating menu would shrink to minWidth and break labels such as `Delete from here` onto two lines. The
	 * menu should shrink only when maxWidth is reached.
	 *
	 * Rows inside a fixed-width container (choice.tsx) are the opposite case and do need flex 1.
	 */
	itemLabel: { flexShrink: 1 },
	/**
	 * The indicator sits at the right end, like web's absolute right-2.
	 *
	 * It was once in the flow on the left, justified by the claim that web also leaves room on the
	 * left. That claim was wrong. Web's DropdownMenuRadioItem and CheckboxItem use pr-8 pl-2 with the
	 * indicator absolute right-2, so labels start 8 from the left edge. The app started at 34
	 * (device-measured; see docs/design/VISUAL-PARITY.md).
	 *
	 * The worry that check marks would zigzag with label length only applied while the indicator was
	 * in the flow. Outside it, the indicator stays on one vertical line.
	 */
	indicator: {
		alignItems: "center",
		bottom: 0,
		justifyContent: "center",
		position: "absolute",
		right: space.sm,
		top: 0,
		width: iconSize.md,
	},
	/**
	 * Only rows that pick a value leave room on the right, like web's pr-8. A plain MenuItem has no
	 * such space (web uses px-2), so this value is not part of item.
	 */
	choiceItem: { paddingRight: space["2xl"] },
	/**
	 * Group name: web px-2 py-1.5 text-xs.
	 *
	 * Vertical padding is space.xs + 2 (6), not space.xs (4) as it was before. On a device the label
	 * box measured 24 in the app against 28 on the web. The 6 is off the token scale on purpose. Like
	 * the 14 in the notification rows, the value comes from the box height web already defined.
	 * Rounding to the nearest token would break that contract.
	 */
	groupLabel: {
		paddingHorizontal: space.sm,
		paddingVertical: space.xs + 2,
	},
	/** Same value as SelectOption, so two rows on the same primitive lock the same way. */
	disabled: { opacity: 0.6 },
	separator: { height: borderWidth, marginVertical: space.xs },
	ring: {
		borderRadius: radiusScale.md,
		borderWidth: borderWidth,
		bottom: 0,
		left: 0,
		position: "absolute",
		right: 0,
		top: 0,
	},
});
