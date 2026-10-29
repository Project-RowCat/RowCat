import * as MenuPrimitive from "@rn-primitives/dropdown-menu";
import { borderWidth, iconSize, radiusScale, space } from "@rowcat/design";
import type { ReactNode } from "react";
import {
	ScrollView,
	StyleSheet,
	useWindowDimensions,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "./icon.tsx";
import { controlHeight, targetSlop } from "./metrics.ts";
import { useSelectionFeedback } from "./selection-feedback.tsx";
import { Text } from "./text.tsx";
import { useTheme } from "./theme.tsx";

/**
 * A closed control that picks one value. The web equivalent is `Select`; the native counterpart to
 * ChoiceGroup.
 * - The difference is whether the list is always visible. ChoiceGroup shows every row, for short
 *   choices where choosing is the whole screen. Select shows only the current value and opens on
 *   press, for a row among other properties.
 * - When a screen has several axes with lists longer than a few rows, an always-open list turns
 *   the screen into a chooser. The user came to see what is applied; a closed trigger answers that.
 *   The web's room settings made the same call.
 * - It sits over the anchored menu because the web Select opens a popover above the dialog. The
 *   popover is provided by @rn-primitives/dropdown-menu, with role="menu", outside taps, Android
 *   back, and screen-reader escape. This is not stacking two layers of the same kind: a stacked
 *   dialog would carry its own content, and escape would have two owners. This layer is attached to
 *   one control and disappears when a value is picked, as web Select does inside a dialog.
 * - The trigger shows the value. DropdownMenu's trigger is an icon; this one is the current
 *   value. Merging them would make either `icon` or `value` a meaningless prop in one of the two.
 * - Not here: search (reconsider once a list passes fourteen items; at three rows it makes
 *   picking a two-step action), multi-select (this control carries one value), and free text (a
 *   typed value not in the list would be saved but never run).
 */

/**
 * Vertical margin so the menu never fills the whole screen height. Space above and below must stay
 * visible.
 */
const VIEWPORT_MARGIN = space.xl;

/**
 * Horizontal margin, narrower than the vertical one. It applies only when the menu width would
 * exceed the screen. Using the vertical value would make the menu narrower than a full-width
 * trigger inside a dialog, so the chosen value and the list would not line up.
 */
const HORIZONTAL_MARGIN = space.md;

export function Select({
	label,
	value,
	disabled,
	children,
}: {
	/**
	 * Accessible name of the trigger, read together with the value (for example `Generation target provider. RowCat`).
	 * Without a name only the value is read, and the user cannot tell whether it is a model, a
	 * provider, or a response length. A settings screen shows three identical-looking triggers.
	 */
	label: string;
	value: string;
	/**
	 * Not choosable: the storage is not open yet, or the value is inherited and there is nothing to
	 * pick. It stays visible but dimmed, not hidden, because hiding it loses what currently applies,
	 * which is the reason the control exists.
	 */
	disabled?: boolean;
	children: ReactNode;
}) {
	const { colors, fieldSurface } = useTheme();

	/**
	 * When disabled, no menu is mounted at all. Passing `disabled` to the primitive would still keep
	 * the portal and overlay in the tree for a layer that never opens. An inherited model field is a
	 * value to read, not an action; the web renders an `output` element in the same spot.
	 */
	if (disabled)
		return (
			<View
				accessibilityRole="text"
				accessibilityLabel={`${label}. ${value}`}
				style={[
					select.trigger,
					select.disabled,
					{ backgroundColor: colors.muted, borderColor: colors.border },
				]}
			>
				<Text
					variant="label"
					tone="muted-foreground"
					numberOfLines={1}
					style={select.value}
				>
					{value}
				</Text>
			</View>
		);

	return (
		<MenuPrimitive.Root>
			<MenuPrimitive.Trigger
				accessibilityRole="button"
				accessibilityLabel={`${label}. ${value}`}
				/**
				 * The visible box is 36. The 44pt touch target comes from hitSlop, so the trigger does not
				 * touch its neighbors.
				 */
				hitSlop={targetSlop(controlHeight.md)}
				style={({ pressed }) => [
					select.trigger,
					/**
					 * The surface comes from the appearance, matching the web's `bg-transparent dark:bg-input/30`.
					 */
					{ backgroundColor: fieldSurface, borderColor: colors.border },
					pressed && { backgroundColor: colors.muted },
				]}
			>
				<Text variant="label" numberOfLines={1} style={select.value}>
					{value}
				</Text>
				<Icon name="chevron-down" size="md" tone="muted-foreground" />
			</MenuPrimitive.Trigger>
			<SelectMenu>{children}</SelectMenu>
		</MenuPrimitive.Root>
	);
}

/**
 * The opened list, as a single portal layer. It is a sibling of `Select`, not nested inside it,
 * because the trigger's geometry (`triggerPosition`) lives in the primitive's context, which is
 * readable only inside `Root`.
 * - Width comes from the trigger, not from content. The layer is absolutely positioned, so its
 *   width is the children's intrinsic width. Option labels use `flex: 1` (flexBasis 0) and
 *   contribute nothing to that width. The menu would collapse to padding plus the check icon, about
 *   50pt, and names would wrap letter by letter ("Ro / wC / at"). That happened. The web does this
 *   on purpose: Radix matches the popover width to the trigger through `--radix-*-trigger-width`.
 *   The chosen value and the list should share a width so the eye links them.
 * - Height is capped. The managed model list runs about seventeen rows plus six company headings,
 *   more than 900pt, taller than a phone screen. Collision avoidance moves the menu but does not
 *   clip it, so the top or bottom items could sit off-screen and be unreachable. The inner list
 *   must scroll: a ScrollView without `flexShrink: 1` turns scrolling off entirely, because the
 *   default style has no flex and height grows to content. The cap then clips it without making it
 *   scrollable (dialog.tsx documents the same pitfall).
 */
function SelectMenu({ children }: { children: ReactNode }) {
	const { colors } = useTheme();
	const insets = useSafeAreaInsets();
	const { width, height } = useWindowDimensions();
	const { triggerPosition } = MenuPrimitive.useRootContext();

	/**
	 * The horizontal margins must equal the margins passed to collision avoidance. If they differ, the
	 * menu is pushed into a narrower slot than its own cap, or the cap shrinks a width avoidance
	 * already allowed.
	 */
	const maxWidth = width - insets.left - insets.right - HORIZONTAL_MARGIN * 2;

	return (
		<MenuPrimitive.Portal>
			{/**
			 * No color. This layer's only job is to receive taps outside the menu. A dimmed background would
			 * read
			 * as a sheet, and this control already sits inside a dialog.
			 */}
			<MenuPrimitive.Overlay style={select.overlay} />
			<MenuPrimitive.Content
				align="start"
				sideOffset={space.xs}
				insets={{
					top: insets.top + VIEWPORT_MARGIN,
					bottom: insets.bottom + VIEWPORT_MARGIN,
					left: insets.left + HORIZONTAL_MARGIN,
					right: insets.right + HORIZONTAL_MARGIN,
				}}
				style={{
					...select.content,
					backgroundColor: colors.popover,
					/**
					 * The width is not stated until the trigger has been measured. The portal does not render in
					 * that frame anyway (`Portal` returns null without `triggerPosition`).
					 */
					width: triggerPosition?.width,
					maxWidth,
					maxHeight: height - insets.top - insets.bottom - VIEWPORT_MARGIN * 2,
				}}
			>
				<ScrollView
					style={select.list}
					keyboardShouldPersistTaps="handled"
					/** Pulling past the end of the list does not move the surface behind it. */
					overScrollMode="never"
					bounces={false}
				>
					{children}
				</ScrollView>
				<View
					pointerEvents="none"
					style={[select.ring, { borderColor: colors.border }]}
				/>
			</MenuPrimitive.Content>
		</MenuPrimitive.Portal>
	);
}

/**
 * The selected row gets a marker. Weight or color alone is not enough: a color-blind user would see
 * no marker, and a list scanned by eye would have no visible current value. Why an option cannot be
 * chosen is in its label (for example `Anthropic · connect the provider first`). Dimming alone gives a screen-reader
 * user no reason. The label is built by the list builder in
 * @rowcat/chat,
 * together with the app's copy table.
 */
export function SelectOption({
	label,
	selected,
	disabled,
	onSelect,
}: {
	label: string;
	selected: boolean;
	disabled?: boolean;
	onSelect: () => void;
}) {
	const { colors } = useTheme();
	const feedback = useSelectionFeedback();
	return (
		<MenuPrimitive.Item
			textValue={label}
			disabled={disabled}
			onPress={() => {
				if (!selected) feedback();
				onSelect();
			}}
			style={({ pressed }) => [
				select.item,
				disabled && select.disabled,
				pressed && !disabled && { backgroundColor: colors.accent },
			]}
		>
			<Text
				variant="body"
				tone={disabled ? "muted-foreground" : "popover-foreground"}
				weight={selected ? "semibold" : "regular"}
				style={select.value}
			>
				{label}
			</Text>
			{selected ? (
				<View pointerEvents="none" style={select.indicator}>
					<Icon name="check" size="md" tone="popover-foreground" />
				</View>
			) : null}
		</MenuPrimitive.Item>
	);
}

/**
 * A heading row for a company group. It is not an `Item`: an `Item` could be pressed, and assistive
 * tech would count it as a choice.
 */
export function SelectGroupLabel({ label }: { label: string }) {
	return (
		<View style={select.groupLabel}>
			<Text variant="caption" tone="muted-foreground">
				{label}
			</Text>
		</View>
	);
}

const select = StyleSheet.create({
	/**
	 * Matches the web's 36. The 44pt touch floor is filled by `hitSlop`: the visible box and the touch
	 * target are separate axes (see metrics.ts). An earlier comment merged them into one value of 44,
	 * which missed that.
	 */
	trigger: {
		alignItems: "center",
		borderRadius: radiusScale.md,
		borderWidth: borderWidth,
		flexDirection: "row",
		gap: space.sm,
		/**
		 * Value on the left, chevron on the right, matching the web's `justify-between`. Until now this
		 * layout came from the value's `flex: 1` as a side effect, and it collapsed wherever that did not
		 * grow.
		 */
		justifyContent: "space-between",
		/**
		 * Not a fixed height. `Input` makes the same choice for the same reason. Under a large
		 * accessibility font scale, the other controls in this app all grow (measured on device: Button
		 * 36 to 55.3, Input 36 to 57.3, Textarea 88 to 192.7, AppBar 56 to 72.7). This trigger alone
		 * stayed at `height: 36`, so enlarged text was clipped inside the box. At normal size nothing
		 * changes, since the text's natural height is under 36.
		 */
		minHeight: controlHeight.md,
		paddingHorizontal: space.md,
		paddingVertical: space.xs,
	},
	/**
	 * A long model name truncates instead of pushing the chevron out. The mechanism is `flexShrink`,
	 * not `flex`. `flex: 1` also sets `flexBasis: 0`, which is correct in a column that stretches, but
	 * in a row whose width comes from its content it contributes zero width, and the text disappears.
	 * Reading the source would not catch this, since `flex: 1` looks right in every container. The
	 * visual QA lab's Adjacency row caught it: the web drew `Save` where native drew an empty box
	 * (Select 50.0 against 71.0; docs/design/VISUAL-PARITY.md).
	 */
	value: { flexShrink: 1 },
	disabled: { opacity: 0.6 },
	overlay: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0 },
	/**
	 * The web's `SelectContent` has no padding and uses `ring-1`, which takes no layout space. On
	 * device the same list measured 64.0 on the web and 74.0 in the app. The 10pt difference was
	 * exactly these parts:
	 *   web: 0 + 32 + 32 + 0 = 64.0
	 *   app: border 1 + 4 + 32 + 32 + 4 + border 1 = 74.0
	 * `DropdownMenu`, by contrast, has `p-1` on the web. Both sit on the same primitive but differ in
	 * padding, and the web sets that difference.
	 */
	content: {
		borderRadius: radiusScale.md,
	},
	/** A ring outside the flow, on the same layer as `Card` and `DropdownMenu`. */
	ring: {
		borderRadius: radiusScale.md,
		borderWidth: borderWidth,
		bottom: 0,
		left: 0,
		position: "absolute",
		right: 0,
		top: 0,
	},
	/**
	 * The same 32 and 8 as the web's `SelectItem` (`py-1.5 pl-2 text-sm`). Rows touch each other, so
	 * `hitSlop` cannot enlarge them without overlapping the neighbor. The visible height is the
	 * target.
	 */
	item: {
		alignItems: "center",
		flexDirection: "row",
		gap: space.sm,
		minHeight: controlHeight.sm,
		paddingHorizontal: space.sm,
		/** Matches the web's `pr-8`: room reserved for the selected indicator. */
		paddingRight: space["2xl"],
	},
	/**
	 * The web places the indicator absolutely at `right-2 size-4`, always on the box's right edge.
	 * Placed in flow after the label, it would move with the label's length. On device the app's check
	 * sat at about x 156, while the web's was at about x 346 in a 358-wide box.
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
	 * Without `flexShrink: 1`, scrolling is disabled entirely (see the `SelectMenu` header). Short
	 * lists are unaffected, since they never reach the cap.
	 */
	list: { flexShrink: 1 },
	groupLabel: { paddingHorizontal: space.md, paddingVertical: space.xs },
});
