import { ActivityIndicator, View } from "react-native";
import type { NativeProgressStyle } from "./styles.ts";
import { runtimeStyles } from "./theme.ts";

/**
 * Progress: a known-extent progress when there is a value, an indeterminate one when there is not.
 *
 * The two cases are not drawn with one visual. A 0% bar for an unknown extent would claim that
 * nothing has happened, and a spinner where a value exists would hide the number the creator
 * computed. The value is already clamped in props.ts; the width math here guards its own input
 * anyway.
 */

export function RuntimeProgress({
	value,
	style,
}: {
	value: number | null;
	style: NativeProgressStyle | null;
}) {
	if (value === null)
		return (
			<View style={style ?? undefined}>
				<ActivityIndicator accessibilityRole="progressbar" />
			</View>
		);
	const ratio = Math.min(1, Math.max(0, value));
	return (
		<View
			style={[runtimeStyles.progressTrack, style]}
			accessibilityRole="progressbar"
			accessibilityValue={{ min: 0, max: 1, now: ratio }}
		>
			<View
				style={[runtimeStyles.progressFill, { width: `${ratio * 100}%` }]}
			/>
		</View>
	);
}
