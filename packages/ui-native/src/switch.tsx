import { Switch as NativeSwitch } from "react-native";
import { useTheme } from "./theme.tsx";

/**
 * Switch: an on/off setting, in the same slot as the web @rowcat/ui-web Switch.
 *
 * Behavior comes from React Native core's Switch. A hand-built primitive would make role, toggle
 * gesture and on/off announcements this package's job, and any of them could be wrong silently.
 * Core already maps them to the platform's native switch (switch role, value state). This package
 * adds only color and name.
 *
 * The name is required. A control with no image or text reads only as 'switch' to a screen reader,
 * which cannot say what it toggles. The same rule applies to IconButton's required label.
 *
 * The on track uses primary, as the web's switch does. Without it the platform default (iOS green)
 * appears, which is not a token in this product.
 */
export function Switch({
	label,
	value,
	onValueChange,
	disabled,
}: {
	/** Accessible name. Use the same sentence as the on-screen label. */
	label: string;
	value: boolean;
	onValueChange: (value: boolean) => void;
	disabled?: boolean;
}) {
	const { colors } = useTheme();
	return (
		<NativeSwitch
			accessibilityLabel={label}
			value={value}
			onValueChange={onValueChange}
			disabled={disabled}
			trackColor={{ false: colors.input, true: colors.primary }}
			/**
			 * Pins the thumb color. Android's default thumb is tinted in the track's hue, so on and off
			 * differ by color alone, and people who cannot tell colors apart would lose the state. A light
			 * thumb keeps the position readable in both states.
			 */
			thumbColor={colors.background}
			ios_backgroundColor={colors.input}
		/>
	);
}
