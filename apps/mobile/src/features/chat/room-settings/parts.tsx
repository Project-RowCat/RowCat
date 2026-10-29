import { borderWidth, space } from "@rowcat/design";
import { controlHeight, Icon, Text, useTheme } from "@rowcat/ui-native";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";

/**
 * Layout parts for the settings home: one row and one group of rows. Writing markup per row would
 * let touch height, press feedback and truncation rules drift row by row, visible only on narrow
 * screens. Web's `features/chat/room-settings/parts.tsx` draws the same hierarchy.
 *
 * Not a general settings framework and not lifted into `@rowcat/ui-native`: that package holds
 * feature-agnostic primitives, and a single-consumer layout there would harden this screen's
 * decisions into shared vocabulary.
 */

/**
 * A titled group of rows. No bordered box: the dialog is already a floating surface, and a second
 * surface blurs list versus container and pushes row text inward of the title, leaving two vertical
 * lines to follow. One line divides groups instead. Groups are kept (not just spacing) because the
 * three groups genuinely differ in character (how it is made, what this conversation is, what to do
 * with it).
 *
 * The left edge is single: rows pull outward (negative margin below) so title and row text start on
 * the same line; the pulled-out width is where the press background extends, not indentation.
 */
export function RoomSettingsGroup({
	title,
	first,
	children,
}: {
	title: string;
	/** The first group has no top line or margin; the window header already draws the boundary. */
	first?: boolean;
	children: ReactNode;
}) {
	const { colors } = useTheme();
	return (
		<View
			style={[
				group.root,
				!first && [group.divided, { borderTopColor: colors.border }],
			]}
		>
			{/* Web's title is `text-xs font-medium`; `caption` defaults to `regular`, which would weigh the title like the summaries below and collapse a layer of the list. */}
			<Text
				accessibilityRole="header"
				variant="caption"
				weight="medium"
				tone="muted-foreground"
			>
				{title}
			</Text>
			<View style={group.rows}>{children}</View>
		</View>
	);
}

/**
 * One row of the settings home; always a button. A `View` + `onPress` has no role or name for
 * assistive technology, and that absence is silent in touch-based review.
 *
 * The summary is part of the button: the target is the whole row, and the accessible name reads
 * title, summary and warning together so nobody enters "Generation settings" without hearing what applies now.
 *
 * Three layers, same values as web: title (body, medium, foreground), summary (label, regular,
 * muted), chevron (muted). Layers come from color and weight; web uses one size (`text-sm`) and
 * native's type scale differs only because `body` 15 / `label` 13 are what exist, so the weight
 * axis follows web. For a while the summary kept `label`'s default `medium`, so color alone
 * separated the lines and they read as one lump.
 *
 * No leading icon: web's settings home has none, and adding it here would make the same screen read
 * at different densities, with meaningless icons for three of five rows.
 */
export function RoomSettingsRow({
	title,
	summary,
	warning,
	navigational,
	destructive,
	onPress,
}: {
	title: string;
	/** One-line summary of the current value; omit while unknown (the slot stays empty). */
	summary?: string | null;
	/**
	 * One line saying the user should look inside; the reason is given there. A separate line from the
	 * summary because "what applies" and "can it be used" are distinct facts, each true or false on
	 * its own. Only this line gets an icon so color is not the sole signal (`Delete conversation` in the same list
	 * shares the color); the sentence still carries the meaning.
	 */
	warning?: string | null;
	/** Pressing goes to another pane; the chevron says so. */
	navigational?: boolean;
	/**
	 * Row leading to an irreversible action. Color alone is not readable by everyone, so the
	 * confirmation dialog still guards the boundary; color only distinguishes the row from ordinary
	 * navigation, hence no chevron and no big warning box (if every row warns, none does).
	 */
	destructive?: boolean;
	onPress: () => void;
}) {
	const { colors } = useTheme();
	return (
		<Pressable
			accessibilityRole="button"
			/* One name for all three layers; separate child `Text` reads would read the row three times with no clear button name. */
			accessible
			accessibilityLabel={[title, summary, warning].filter(Boolean).join(". ")}
			onPress={onPress}
			style={({ pressed }) => [
				row.root,
				pressed && { backgroundColor: colors.muted },
			]}
		>
			<View style={row.text}>
				<Text
					variant="body"
					weight="medium"
					tone={destructive ? "destructive" : "foreground"}
					numberOfLines={1}
				>
					{title}
				</Text>
				{summary ? (
					<Text
						variant="label"
						weight="regular"
						tone="muted-foreground"
						numberOfLines={1}
					>
						{summary}
					</Text>
				) : null}
				{warning ? (
					<View style={row.warning}>
						<Icon name="warning" size="sm" tone="destructive" />
						<Text variant="label" tone="destructive" style={row.warningText}>
							{warning}
						</Text>
					</View>
				) : null}
			</View>
			{navigational ? (
				<Icon name="chevron-right" size="md" tone="muted-foreground" />
			) : null}
		</Pressable>
	);
}

const group = StyleSheet.create({
	root: { gap: space.xs },
	/** The group owns the spacing between groups; with a parent `gap` the line would float between two margins and belong to a group only by margin size. */
	divided: {
		borderTopWidth: borderWidth,
		marginTop: space.md,
		paddingTop: space.md,
	},
	rows: { marginHorizontal: -space.sm },
});

const row = StyleSheet.create({
	root: {
		alignItems: "center",
		flexDirection: "row",
		gap: space.md,
		/* Touch floor: a one-line row (`Rename`) is shorter than this from text height plus padding, and stacked rows cannot widen via `hitSlop` (it would overlap neighbours). Visible height is the target. */
		minHeight: controlHeight.md,
		paddingHorizontal: space.sm,
		paddingVertical: space.sm,
	},
	/** Takes the remaining width so larger text wraps. */
	text: { flex: 1, gap: space.px },
	warning: { alignItems: "center", flexDirection: "row", gap: space.xs },
	warningText: { flex: 1 },
});
