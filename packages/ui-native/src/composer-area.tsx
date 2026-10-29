import { borderWidth } from "@rowcat/design";
import type { ReactNode } from "react";
import { type StyleProp, StyleSheet, View, type ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSoftKeyboardVisible } from "./keyboard.ts";
import { useTheme } from "./theme.tsx";

/**
 * Owns the bottom edge of a screen with a bottom-anchored control strip, including its safe area.
 * - Each edge has exactly one owner. Screen owns top, left and right; this owns bottom when no
 *   keyboard is shown. Before this existed, Screen's comment named an owner that did not exist, and
 *   the input overlapped the home indicator.
 * - The background and top border run to the physical bottom. Only inner padding respects the
 *   safe area, or the screen behind shows as a strip under the home indicator.
 * - Left and right are not padded here. Screen owns them, and padding twice would break on
 *   horizontally overflowing devices.
 * - Inner controls stay device-agnostic so they can be reused where insets are unknown.
 */
export function ComposerArea({
	children,
	style,
}: {
	/**
	 * May be empty, in which case the component only owns the bottom edge. A screen with no controls
	 * still needs an owner for that edge, or its last row sits under the home indicator. Adding the
	 * safe-area value to that screen's list padding instead would make it compute the safe area a
	 * second time.
	 */
	children?: ReactNode;
	style?: StyleProp<ViewStyle>;
}) {
	const insets = useSafeAreaInsets();
	const keyboardVisible = useSoftKeyboardVisible();
	const { colors } = useTheme();

	return (
		<View
			style={[
				area.root,
				{
					backgroundColor: colors.background,
					borderTopColor: colors.border,
					/**
					 * Zero while the on-screen keyboard is up: the keyboard already covers that area, and padding
					 * would leave an empty 34pt strip between the input and the keyboard. With a hardware keyboard
					 * the inset stays, since no soft keyboard is shown and the home indicator is still visible
					 * (see useSoftKeyboardVisible).
					 */
					paddingBottom: keyboardVisible ? 0 : insets.bottom,
				},
				style,
			]}
		>
			{children}
		</View>
	);
}

const area = StyleSheet.create({
	root: { borderTopWidth: borderWidth },
});
