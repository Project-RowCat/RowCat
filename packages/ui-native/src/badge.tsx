import {
	borderWidth,
	fontSize,
	lineHeight,
	radiusScale,
	space,
} from "@rowcat/design";
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "./theme.tsx";
import { typeface } from "./typography.ts";

/**
 * Short label: grade, visibility, trait, tag, or own work. Mirrors web's `badge.tsx`: same variant
 * names and relationships. `secondary` is the default, `destructive` is a light red surface with
 * bright red text, and `outline` is border only. The shape follows web too (`rounded-4xl`, a pill),
 * since list cards and detail pages must draw the same words the same way. No icon prop. A badge
 * carries one word. Text can be translated; a picture cannot.
 */

export type BadgeVariant =
	| "secondary"
	| "destructive"
	| "outline"
	| "default"
	/**
	 * Faint text on the secondary surface, the same as web's `font-normal text-muted-foreground` on
	 * tag badges. Kept separate from `secondary` because they say different things. Grade and
	 * visibility, which define what a work is, use `secondary` (strong text). Tags sit beside them but
	 * read second. At the same weight they would compete with the title.
	 */
	| "muted";

export function Badge({
	label,
	variant = "secondary",
}: {
	label: string;
	variant?: BadgeVariant;
}) {
	const { colors, alpha } = useTheme();

	const surface = {
		default: { backgroundColor: colors.primary },
		secondary: { backgroundColor: colors.secondary },
		destructive: { backgroundColor: alpha("destructive", 0.14) },
		outline: {
			borderColor: colors.border,
			borderWidth: borderWidth,
		},
		muted: { backgroundColor: colors.secondary },
	}[variant];

	const ink = {
		default: colors["primary-foreground"],
		secondary: colors["secondary-foreground"],
		destructive: colors.destructive,
		outline: colors.foreground,
		muted: colors["muted-foreground"],
	}[variant];

	return (
		<View style={[badge.root, surface]}>
			<Text
				numberOfLines={1}
				style={[
					badge.label,
					variant === "muted" && badge.labelMuted,
					{ color: ink },
				]}
			>
				{label}
			</Text>
		</View>
	);
}

const badge = StyleSheet.create({
	root: {
		alignSelf: "flex-start",
		borderRadius: radiusScale.full,
		justifyContent: "center",
		/*
		 * Web uses `h-5 px-2 py-0.5`: height 20, horizontal 8, vertical 2. The height is set as a value
		 * on purpose. Padding alone would let line height decide, making the pill a pixel or two taller
		 * than web's, and the difference shows when several badges share a row. `minHeight`, so the label
		 * is not clipped at large text sizes.
		 */
		minHeight: 20,
		paddingHorizontal: space.sm,
		paddingVertical: 2,
	},
	label: {
		/*
		 * Same value as web's `text-xs`. The earlier `caption - 1` (11) was off the type scale with no
		 * recorded reason. That 1pt made badge text smaller than web, so grade and visibility labels read
		 * one step lighter.
		 */
		fontSize: fontSize.caption,
		lineHeight: lineHeight.caption,
		...typeface("medium"),
	},
	/** Web's `font-normal`. Adding bold to muted text would cancel the reason it is muted. */
	labelMuted: typeface("regular"),
});
