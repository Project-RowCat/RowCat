import type {
	ChatVisibleTrackingBlockKind,
	VisibleChatTrackingBlock,
} from "@rowcat/chat";
import { radiusScale, space } from "@rowcat/design";
import { Icon, Text, useTheme } from "@rowcat/ui-native";
import { useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";

/**
 * The cast card a narration pack appends to a response; same decision as the web's panel
 * (`chat-tracking-panel.tsx` explains why this is not markdown: raw HTML folds to characters, so
 * tags and internal state would show at the end of every response). Only the drawing differs; both
 * apps split blocks off with `splitChatTrackingBlocks`.
 *
 * The block kind is already narrowed by the body side, so passing the progress log here does not
 * compile (`visibleChatTrackingBlocks`).
 *
 * Horizontal scroll is the whole layout: the internal state is long pipe-separated lines that
 * always overflow, and unconstrained they stretch the entire bubble on narrow screens.
 */
export function TrackingPanel({ block }: { block: VisibleChatTrackingBlock }) {
	const { colors } = useTheme();
	const [open, setOpen] = useState(false);
	if (!block.content) return null;

	return (
		<View style={[styles.root, { borderColor: colors.border }]}>
			<Pressable
				onPress={() => setOpen((previous) => !previous)}
				accessibilityRole="button"
				accessibilityState={{ expanded: open }}
				style={styles.header}
			>
				<Icon name={open ? "chevron-down" : "chevron-right"} size="sm" />
				<Text variant="caption" tone="muted-foreground">
					{TRACKING_PANEL_LABEL[block.kind]}
				</Text>
			</Pressable>
			{open ? (
				<ScrollView
					horizontal
					style={[styles.body, { borderTopColor: colors.border }]}
					/**
					 * Keep the indicator visible: content is always clipped on the right, and with no mark there
					 * the screen reads as broken rather than scrollable (reported). The web panel's
					 * `overflow-x-auto` shows its bar too.
					 */
					showsHorizontalScrollIndicator
				>
					{/*
					 * Verbatim, not parsed as a table: the format is the pack's own, and claiming to
					 * know it breaks silently when the pack is updated.
					 */}
					<Text variant="caption" tone="muted-foreground">
						{block.content}
					</Text>
				</ScrollView>
			) : null}
		</View>
	);
}

/** Panel name; the original work's English name is not shown (same word as the web). */
const TRACKING_PANEL_LABEL: Record<ChatVisibleTrackingBlockKind, string> = {
	cast: "Character cards",
};

const styles = StyleSheet.create({
	root: {
		marginTop: space.md,
		borderWidth: StyleSheet.hairlineWidth,
		borderRadius: radiusScale.md,
	},
	header: {
		flexDirection: "row",
		alignItems: "center",
		gap: space.xs,
		paddingHorizontal: space.sm,
		paddingVertical: space.xs,
	},
	body: {
		borderTopWidth: StyleSheet.hairlineWidth,
		paddingHorizontal: space.sm,
		paddingVertical: space.xs,
	},
});
