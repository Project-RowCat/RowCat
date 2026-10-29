import { BlurView } from "expo-blur";
import { StyleSheet } from "react-native";
import { useTheme } from "./theme.tsx";

/**
 * Backdrop of floating layers. The web equivalent is `bg-black/10
 * supports-backdrop-filter:backdrop-blur-xs`. Most of the visible effect comes from the blur. A 10%
 * black alone leaves the screen behind sharp enough to compete with the dialog. On the web the
 * backdrop is a blurred dialog; in this app it had been a 60% black film, a common native default
 * with no recorded basis.
 * - Web: rgba(0,0,0,0.1) plus blur(4px).
 * - Native: the same black plus BlurView. BlurView is the only native counterpart to CSS
 *   backdrop-filter. Cost: expo-blur is a native module and needs a rebuild, like react-native-svg
 *   and react-native-reanimated. It is listed as an exception in boundaries.test.ts. Pure
 *   JavaScript cannot produce this effect, and raising opacity would be a different picture with an
 *   invented value. Tint follows appearance. iOS blur always comes with a material tint, so the
 *   current appearance is passed through: a dark material in light mode would make the backdrop
 *   night-like, and the reverse would leave the screen behind washed out. Intensity is low. The
 *   web's blur-xs is 4px, while the system default (100) would erase the screen behind and turn the
 *   blur into an opaque panel.
 */

/** The web's bg-black/10. A layer over the blur, not a backdrop by itself. */
export const SCRIM_COLOR = "rgba(0, 0, 0, 0.1)";

/**
 * Equivalent of the web's blur-xs (4px). expo-blur's intensity is a 0-100 material strength, not a
 * pixel radius, so it cannot be copied 1:1. The value was chosen by comparing two screens side by
 * side; change it the same way.
 */
export const SCRIM_BLUR_INTENSITY = 24;

/**
 * Does not capture touches. Tap-outside dismissal belongs to the primitive's Overlay. If this layer
 * caught the touch, closing by tapping outside would stop working, and the only symptom would be a
 * quiet one.
 */
export function ScrimBlur() {
	const { scheme } = useTheme();
	return (
		<BlurView
			intensity={SCRIM_BLUR_INTENSITY}
			pointerEvents="none"
			style={StyleSheet.absoluteFill}
			tint={scheme}
		/>
	);
}
