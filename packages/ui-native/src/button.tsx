import type { ColorName } from "@rowcat/design";
import { borderWidth, fontSize, radiusScale, space } from "@rowcat/design";
import type { ReactNode } from "react";
import {
	ActivityIndicator,
	Pressable,
	type StyleProp,
	StyleSheet,
	Text,
	type ViewStyle,
} from "react-native";
import { BrandMark, type BrandName } from "./brand-mark.tsx";
import { Icon, type IconName } from "./icon.tsx";
import { type ControlSize, controlHeight, targetSlop } from "./metrics.ts";
import { useTheme } from "./theme.tsx";
import { typeface } from "./typography.ts";

/**
 * Button: web's hierarchy, sized for fingers.
 * - Variant names and their relationships match web's `button.tsx`. `primary` is strongest,
 *   `secondary` and `outline` sit below it, `ghost` has no surface, and `destructive` is a light
 *   surface with bright red text. The most prominent button on web stays the most prominent here.
 * - Not carried over from web: hover (fingers have no hover; pressed state is used instead),
 *   focus ring (not a platform convention), and translate-y-px (a 1px shift is invisible under a
 *   finger).
 * - Visible heights match web: md 36, sm 32, lg 40 (web's h-9, h-8, h-10). The touch target is
 *   always 44, and `hitSlop` covers the difference.
 * - Earlier the visible height was 44. The finger reasoning was right, but using the touch floor
 *   as the box height was the mismatch. Forms looked sparser than web, and the gap accumulated down
 *   the screen. The two axes are now separate, and the width a finger can reach did not shrink
 *   (`metrics.ts`).
 */

export type ButtonVariant =
	| "primary"
	| "secondary"
	| "outline"
	| "ghost"
	| "destructive";

/**
 * Maps variant to foreground meaning. The label, icon, and busy indicator all read through this one
 * table. Earlier the three chose colors separately: the label and spinner followed the variant, but
 * the icon was fixed to `foreground`, so on dark `primary` surfaces the text was light and the icon
 * dark. That is neither a compile nor a runtime error. It shows only as broken contrast on one
 * icon, and in the other theme the reverse happens, so one bad combination stays invisible to the
 * developer. The table holds color names rather than values because there are two consumers. Text
 * and spinner take color strings (`colors[...]`), and `Icon` takes a name (`tone`). Making the name
 * the authority defines both as pointing at the same slot.
 */
export const BUTTON_FOREGROUND = {
	primary: "primary-foreground",
	secondary: "secondary-foreground",
	outline: "foreground",
	ghost: "foreground",
	destructive: "destructive",
} as const satisfies Record<ButtonVariant, ColorName>;

/**
 * The leading glyph is either a semantic icon or a brand mark, never both. This is a union, not two
 * optional props. With two optional props, passing both compiles, and the render order decides
 * which one draws, a rule that cannot be read at the call site. Here the invalid state cannot be
 * represented. Brands are not in `icon`'s vocabulary; see the `brand-mark.tsx` header for why.
 */
type ButtonGlyph =
	| { icon?: IconName; brand?: never }
	| { icon?: never; brand?: BrandName };

export function Button({
	label,
	onPress,
	variant = "primary",
	size = "md",
	icon,
	brand,
	busy,
	disabled,
	accessibilityLabel,
	accessibilityHint,
	fullWidth,
	style,
}: {
	label: string;
	onPress: () => void;
	variant?: ButtonVariant;
	size?: ControlSize;
	/** While busy, the button is locked and announced to screen readers as `busy`. */
	busy?: boolean;
	disabled?: boolean;
	/**
	 * Needed when the label alone does not identify the target, such as same-named buttons in a list.
	 */
	accessibilityLabel?: string;
	accessibilityHint?: string;
	/** Fills the full row width in layouts that stack vertically. */
	fullWidth?: boolean;
	style?: StyleProp<ViewStyle>;
} & ButtonGlyph) {
	const { colors, alpha, outlineSurface } = useTheme();
	const blocked = Boolean(busy || disabled);

	const surface: Record<ButtonVariant, ViewStyle> = {
		primary: { backgroundColor: colors.primary },
		secondary: { backgroundColor: colors.secondary },
		outline: {
			/** Web's `bg-background dark:bg-input/30`. The theme layer owns the light and dark split. */
			backgroundColor: outlineSurface,
			borderColor: colors.border,
			borderWidth: borderWidth,
		},
		ghost: { backgroundColor: "transparent" },
		destructive: { backgroundColor: alpha("destructive", 0.12) },
	};

	/** The label, icon, and spinner read the same single slot, so they cannot diverge. */
	const foreground = BUTTON_FOREGROUND[variant];
	const ink = colors[foreground];

	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={accessibilityLabel ?? label}
			accessibilityHint={accessibilityHint}
			accessibilityState={{ disabled: blocked, busy: Boolean(busy) }}
			disabled={blocked}
			onPress={onPress}
			/**
			 * The target widens to 44 for all three sizes. Now that the visible height matches web, even the
			 * default size (36) falls short of 44. The line applied only to `sm` before, which was correct
			 * then because `md` was already 44. Buttons do not touch their neighbors, so the enlarged target
			 * has no overlapping area. The reason `hitSlop` is not put on abutting rows is in the metrics.ts
			 * header.
			 */
			hitSlop={targetSlop(controlHeight[size])}
			style={({ pressed }) => [
				button.root,
				/**
				 * `minHeight`, not `height`. With enlarged text, a fixed height clips the label vertically.
				 * This value sets the bottom of the target, not a cap.
				 */
				{ minHeight: controlHeight[size] },
				surface[variant],
				fullWidth ? button.fullWidth : button.hug,
				blocked && button.blocked,
				pressed && !blocked && button.pressed,
				style,
			]}
		>
			{busy ? <ActivityIndicator size="small" color={ink} /> : null}
			{icon && !busy ? <Icon name={icon} size="md" tone={foreground} /> : null}
			{/**
			 * The brand mark also reads the same slot (`tone={foreground}`). Google ignores that value, but
			 * that is
			 * the mark's own rule. No exception is made here, because one would force this file to state which
			 * rule each future mark follows.
			 */}
			{brand && !busy ? (
				<BrandMark name={brand} size="md" tone={foreground} />
			) : null}
			<Text
				numberOfLines={1}
				style={[button.label, { color: ink }, size === "sm" && button.labelSm]}
			>
				{label}
			</Text>
		</Pressable>
	);
}

/**
 * Icon-only button: the name must always come as text. An icon-only button has no name for screen
 * readers, so the screen reads only 'button'. `label` is required, and that is the whole point of
 * this component.
 */
export function IconButton({
	icon,
	label,
	onPress,
	tone = "foreground",
	busy,
	disabled,
	selected,
	hint,
}: {
	icon: IconName;
	/** The name read by screen readers. It is not shown on screen. */
	label: string;
	onPress: () => void;
	tone?: "foreground" | "muted-foreground" | "destructive";
	busy?: boolean;
	disabled?: boolean;
	/**
	 * Whether this button is a toggle. The state is announced too, so it is not conveyed by color
	 * alone.
	 */
	selected?: boolean;
	hint?: string;
}) {
	const blocked = Boolean(busy || disabled);
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			accessibilityHint={hint}
			accessibilityState={{
				disabled: blocked,
				busy: Boolean(busy),
				...(selected === undefined ? {} : { selected }),
			}}
			disabled={blocked}
			onPress={onPress}
			/** The visible box is 36 (web's `size-9`), and the target is 44 around it. */
			hitSlop={targetSlop(controlHeight.md)}
			style={({ pressed }) => [
				button.icon,
				blocked && button.blocked,
				pressed && !blocked && button.pressed,
			]}
		>
			<Icon name={icon} size="lg" tone={tone} />
		</Pressable>
	);
}

/**
 * A text-only action, web's `link` variant. The underline stays: if color alone signals
 * tappability, people who cannot tell colors apart see ordinary text.
 */
export function LinkButton({
	label,
	onPress,
	disabled,
	children,
}: {
	label: string;
	onPress: () => void;
	disabled?: boolean;
	children?: ReactNode;
}) {
	const { colors } = useTheme();
	return (
		<Pressable
			accessibilityRole="button"
			accessibilityLabel={label}
			accessibilityState={{ disabled: Boolean(disabled) }}
			disabled={disabled}
			onPress={onPress}
			/**
			 * A text link is one line high visually (12 to 18pt). The target extends above and below to pass
			 * 44pt. `space.md` (12) reached only 40 to 42, short of the floor, and the shortfall is
			 * invisible on screen.
			 */
			hitSlop={space.lg}
			style={({ pressed }) => [
				pressed && button.pressed,
				disabled && button.blocked,
			]}
		>
			{children ?? (
				<Text style={[button.link, { color: colors["muted-foreground"] }]}>
					{label}
				</Text>
			)}
		</Pressable>
	);
}

const button = StyleSheet.create({
	root: {
		alignItems: "center",
		borderRadius: radiusScale.md,
		flexDirection: "row",
		gap: space.sm,
		justifyContent: "center",
		/*
		 * Web uses `px-2.5` (10). The nearest scale value is 12. The earlier 16 made the same label a
		 * pill 12pt wider than web's. The height is already 8pt more than web's (44 vs 36), so widening
		 * horizontally too would make one button noticeably large.
		 */
		paddingHorizontal: space.md,
		/** When enlarged text exceeds `minHeight`, this padding keeps the label off the border. */
		paddingVertical: space.xs,
	},
	hug: { alignSelf: "flex-start" },
	fullWidth: { alignSelf: "stretch" },
	blocked: { opacity: 0.5 },
	pressed: { opacity: 0.72 },
	label: {
		flexShrink: 1,
		fontSize: fontSize.body,
		/*
		 * Matches web's `font-medium` scale. It was `semibold` before, and the one-step difference was
		 * visible on screens shown side by side: the same label looked heavier in the app only. Hierarchy
		 * comes from surface color (`primary`, `secondary`, `ghost`), not from weight.
		 */
		...typeface("medium"),
	},
	labelSm: { fontSize: fontSize.label },
	icon: {
		alignItems: "center",
		height: controlHeight.md,
		justifyContent: "center",
		width: controlHeight.md,
	},
	link: {
		fontSize: fontSize.caption,
		textDecorationLine: "underline",
		...typeface("regular"),
	},
});
