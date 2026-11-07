import { space } from "@rowcat/design";
import { APP_NAME } from "@rowcat/domain";
import { BrandSymbol, Text } from "@rowcat/ui-native";
import { StyleSheet, View } from "react-native";

/**
 * The same symbol and app name as web. The geometry comes from the design package; rendering
 * stays native. Group the decorative symbol and text into one accessible name.
 */
export function Wordmark({ size = "title" }: { size?: "title" | "display" }) {
	return (
		<View style={styles.lockup} accessible accessibilityLabel={APP_NAME}>
			<BrandSymbol size={size === "display" ? "2xl" : "xl"} />
			<Text
				variant={size}
				weight="bold"
				numberOfLines={1}
				accessible={false}
				style={styles.name}
			>
				{APP_NAME}
			</Text>
		</View>
	);
}

const styles = StyleSheet.create({
	lockup: {
		flexDirection: "row",
		alignItems: "center",
		gap: space.sm,
		flexShrink: 1,
	},
	name: { flexShrink: 1 },
});
