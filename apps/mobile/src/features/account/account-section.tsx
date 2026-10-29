import { space } from "@rowcat/design";
import { Separator, Text } from "@rowcat/ui-native";
import type { ReactNode } from "react";
import { StyleSheet, View } from "react-native";

/**
 * One section of the account screen; counterpart of web `AccountSection` in `account-shell.tsx`.
 *
 * Lives in this feature rather than `@rowcat/ui-native` because it is this screen's vertical
 * rhythm, not a platform primitive; in the UI package the next screen would inherit a rhythm that
 * is not its own. Sections are not wrapped in `Card` (titles already separate them and nested
 * borders only lower density); a separator above each section divides them, and `first` omits it.
 */
export function AccountSection({
	title,
	description,
	first,
	children,
}: {
	title: string;
	/** One line saying what the section decides; omitted when absent so no empty slot remains. */
	description?: string;
	/** First section: no separator above. */
	first?: boolean;
	children: ReactNode;
}) {
	return (
		<View style={section.root}>
			{first ? null : <Separator />}
			<View style={section.head}>
				<Text accessibilityRole="header" variant="title">
					{title}
				</Text>
				{description ? (
					<Text variant="label" tone="muted-foreground">
						{description}
					</Text>
				) : null}
			</View>
			{children}
		</View>
	);
}

/**
 * Read-only name/value pair stacked vertically. `ListRow` is not used because an email cannot be
 * held to one line on narrow screens, and a truncated email is the worst answer on a screen where
 * someone checks their own email. Same shape as web `AccountRow` on narrow widths.
 */
export function AccountRow({ label, value }: { label: string; value: string }) {
	return (
		<View style={section.row}>
			<Text variant="caption" tone="muted-foreground">
				{label}
			</Text>
			<Text variant="body">{value}</Text>
		</View>
	);
}

const section = StyleSheet.create({
	root: { gap: space.md },
	head: { gap: space.xs },
	row: { gap: space.px },
});
