import { space } from "@rowcat/design";
import type { ReactNode } from "react";
import { type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";
import { Text } from "./text.tsx";

/**
 * Pieces of a list. This file does not wrap FlatList.
 *
 * Virtualization settings (keys, column count, end reached, pull to refresh) belong to the screen
 * that knows what the list renders. Wrapping FlatList here would hide them from that screen. This
 * file holds only the shape of a row.
 */

export function ListRow({ label, value }: { label: string; value: string }) {
	return (
		<View style={list.row}>
			<Text variant="label" tone="muted-foreground" style={list.rowLabel}>
				{label}
			</Text>
			<Text variant="label" tone="muted-foreground" style={list.rowValue}>
				{value}
			</Text>
		</View>
	);
}

/** A titled section. Corresponds to the CardHeader plus body on the web. */
export function ListSection({
	title,
	children,
	style,
}: {
	title?: string;
	children: ReactNode;
	style?: StyleProp<ViewStyle>;
}) {
	return (
		<View style={[list.section, style]}>
			{title ? (
				<Text accessibilityRole="header" variant="heading">
					{title}
				</Text>
			) : null}
			{children}
		</View>
	);
}

const list = StyleSheet.create({
	row: { flexDirection: "row", gap: space.md },
	rowLabel: { width: 72 },
	rowValue: { flexShrink: 1 },
	section: { gap: space.md },
});
