import { borderWidth, radiusScale, space } from "@rowcat/design";
import { Button, Icon, Text, useTheme } from "@rowcat/ui-native";
import { StyleSheet, View } from "react-native";
import { RUNTIME_PLAYER_COPY } from "./runtime-player-copy.ts";

/**
 * Progress could not be saved. **The work keeps running.** Same structure as the web's equivalent.
 *
 * What this surface does, and all it does, is sit **outside** the creator's canvas. Inside the
 * creator's tree the sentence would be something the creator could cover, and it would hide the
 * running work. A save failure is not a runtime failure, so there is no reason to stop play.
 *
 * Why `Notice` is not used: `Notice tone="destructive"` in `@rowcat/ui-native` looks exactly like
 * this, but it sets `accessibilityRole="alert"`. That role tells a screen reader to interrupt what
 * it is saying and read the notice, which is right only when a user-started action has failed, as
 * that component's header documents. What failed here is a background write, and saving can succeed
 * on its own at the next commit, so it should not cut into the speech of someone who is playing.
 *
 * The same surface is therefore assembled in this folder, with every value taken from tokens (no
 * color literals, no font sizes). It carries the same weight as the web's `role="status"`
 * (`<output>`).
 */
export function RuntimeSaveNotice({ onRetry }: { onRetry: () => void }) {
	const { alpha } = useTheme();
	return (
		<View
			style={[
				styles.notice,
				{
					backgroundColor: alpha("destructive", 0.08),
					borderColor: alpha("destructive", 0.4),
				},
			]}
		>
			<Icon name="warning" size="md" tone="destructive" />
			<View style={styles.body}>
				<Text variant="label" tone="destructive">
					{RUNTIME_PLAYER_COPY.saveFailed}
				</Text>
				<Text variant="caption" tone="muted-foreground">
					{RUNTIME_PLAYER_COPY.saveFailedBody}
				</Text>
			</View>
			<Button
				label={RUNTIME_PLAYER_COPY.saveRetry}
				variant="outline"
				size="sm"
				onPress={onRetry}
			/>
		</View>
	);
}

const styles = StyleSheet.create({
	notice: {
		alignItems: "flex-start",
		borderRadius: radiusScale.lg,
		borderWidth: borderWidth,
		flexDirection: "row",
		gap: space.sm,
		marginHorizontal: space.lg,
		marginBottom: space.xs,
		padding: space.md,
	},
	/** Takes all remaining width between the icon and the button, so the text wraps. */
	body: { flex: 1, gap: space.xs },
	creatorError: {
		alignItems: "center",
		flexDirection: "row",
		gap: space.sm,
		paddingHorizontal: space.lg,
		paddingVertical: space.xs,
	},
});

/**
 * The creator's code threw. **The screen stays as it is.**
 *
 * Same rule as the web's equivalent line. When a render throws, the VM emits no new commit, so
 * **the previous tree stays valid**, and clearing it would discard what the atomic commit provided.
 * So this line sits below the canvas instead of covering it.
 *
 * It weighs less than a save failure. A save failure means what is being built now is not kept, so
 * missing it loses a whole session of play. Here what is lost is one operation, and the screen is
 * still correct. Drawing both in the same box would make neither readable.
 */
export function RuntimeCreatorErrorNotice({
	onRestart,
}: {
	onRestart: () => void;
}) {
	return (
		<View style={styles.creatorError}>
			<Text variant="caption" tone="destructive" style={styles.body}>
				{RUNTIME_PLAYER_COPY.creatorError}
			</Text>
			<Button
				label={RUNTIME_PLAYER_COPY.retry}
				variant="ghost"
				size="sm"
				onPress={onRestart}
			/>
		</View>
	);
}
