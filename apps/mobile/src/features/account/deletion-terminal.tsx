import { space } from "@rowcat/design";
import { Button, Spinner, Text } from "@rowcat/ui-native";
import { useRouter } from "expo-router";
import { StyleSheet, View } from "react-native";
import {
	DELETION_CLEANUP_FAILED_NOTE,
	DELETION_CLEANUP_FAILED_TITLE,
	DELETION_GO_LOGIN_LABEL,
	DELETION_PURGING_NOTE,
	DELETION_PURGING_TITLE,
	DELETION_RETRY_CLEANUP_LABEL,
} from "./account-copy.ts";
import type { AccountDeletion } from "./use-account-deletion.ts";

/**
 * The screen after the account is gone; it does not return to the account screen (counterpart of
 * web `deletion-terminal.tsx`).
 *
 * Once server deletion is confirmed no account section can be drawn: re-fetching email would be a
 * 401 and the screen a "could not load" wall, which reads as a failure to someone who just deleted
 * their account.
 *
 * Only two phases are drawn (`purging`, `cleanup-failed`); `done` replaces to the login screen
 * immediately. There is no cancel, since nothing remains to cancel.
 *
 * `cleanup-failed` must not say deletion failed, which is false: the account is gone for good. Only
 * this device's cleanup failed, and only that can be retried. The retry needs no auth because the
 * targets are values captured in memory before deletion.
 */
export function DeletionTerminal({ deletion }: { deletion: AccountDeletion }) {
	const router = useRouter();

	if (deletion.phase === "cleanup-failed")
		return (
			<View style={styles.root}>
				<Text accessibilityRole="header" variant="title">
					{DELETION_CLEANUP_FAILED_TITLE}
				</Text>
				<Text accessibilityRole="alert" variant="label" tone="muted-foreground">
					{DELETION_CLEANUP_FAILED_NOTE}
				</Text>
				<View style={styles.actions}>
					<Button
						label={DELETION_RETRY_CLEANUP_LABEL}
						onPress={deletion.retryCleanup}
					/>
					<Button
						label={DELETION_GO_LOGIN_LABEL}
						variant="outline"
						onPress={() => router.replace("/login")}
					/>
				</View>
			</View>
		);

	return (
		<View style={styles.root}>
			<View style={styles.loadingRow}>
				<Spinner />
				<Text accessibilityRole="header" variant="title">
					{DELETION_PURGING_TITLE}
				</Text>
			</View>
			<Text variant="label" tone="muted-foreground">
				{DELETION_PURGING_NOTE}
			</Text>
		</View>
	);
}

const styles = StyleSheet.create({
	root: { gap: space.md, paddingTop: space.xl },
	actions: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
	loadingRow: { alignItems: "center", flexDirection: "row", gap: space.sm },
});
