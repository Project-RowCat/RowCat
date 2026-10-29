import {
	DRAFT_RECOVERY_COPY,
	DRAFT_RECOVERY_GROUP_LABEL,
	summarizeDraftRecoveries,
} from "@rowcat/authoring";
import { space } from "@rowcat/design";
import { Button, Text } from "@rowcat/ui-native";
import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";
import { useAllDraftRecoveries } from "../../lib/local-data/use-recoveries.ts";

/**
 * One row of the sync section — the same rules as web's same-named component, in a different
 * container.
 *
 * It exists because a recovery copy is only visible inside its draft's editor, and days later the
 * user no longer remembers which draft it was. So this row is a **path to the destination**, not a
 * second recovery screen: restore and delete do not happen here.
 *
 * Do not widen this section into a sync history dashboard. Transfer events, device lists and
 * developer-facing conflict counters do not belong here. The only qualification is that the user
 * lost something.
 */
export function RecoverySummary() {
	const router = useRouter();
	const { value: items } = useAllDraftRecoveries();
	if (items.length === 0) return null;

	const summary = summarizeDraftRecoveries(items);

	return (
		<View style={styles.root}>
			<View style={styles.head}>
				<Text variant="body">{DRAFT_RECOVERY_COPY.summaryLabel}</Text>
				<Text variant="label" tone="muted-foreground">
					{summary.total} {summary.total === 1 ? "item" : "items"}
				</Text>
			</View>
			{summary.drafts.map((entry) => (
				<Button
					key={entry.draftId}
					/*
					 * The draft title is not looked up here. Doing so would make this section open the creation
					 * store as well, widening what the account screen knows. The group names already say which
					 * part was affected; the editor header the user follows draws the title.
					 */
					label={entry.groups
						.map((group) => DRAFT_RECOVERY_GROUP_LABEL[group])
						.join(" · ")}
					variant="ghost"
					size="sm"
					fullWidth
					onPress={() => router.push(`/create/${entry.draftId}`)}
				/>
			))}
		</View>
	);
}

const styles = StyleSheet.create({
	root: { gap: space.xs },
	head: {
		alignItems: "baseline",
		flexDirection: "row",
		gap: space.sm,
		justifyContent: "space-between",
	},
});
