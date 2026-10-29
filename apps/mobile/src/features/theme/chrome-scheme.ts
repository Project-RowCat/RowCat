import { themeSurfaceScheme } from "@rowcat/design";

/**
 * Color of the status bar icons: **derived from the background currently drawn.**
 *
 * ## Why not `scheme`
 *
 * For a while `ThemedChrome` asked this:
 *
 * ```text
 * const { colors, scheme } = useTheme();
 * <StatusBar style={scheme === "dark" ? "light" : "dark"} />
 * ```
 *
 * The flaw is that the two values come from different sources. `scheme` is **device appearance**,
 * while `colors.background` is the **effective color** after the account theme is applied, so the
 * two diverge as soon as an account covers the background:
 *
 * ```text
 * device appearance = light  ·  account preset = black
 *     → colors.background is nearly black
 *     → yet the status bar draws dark icons
 * ```
 *
 * A dark icon on a dark background is **invisible.** The reverse combination (device dark + white
 * preset) is a defect of the same size, and arbitrary colors can produce it in either direction.
 *
 * ## The inversion lives in one place
 *
 * `expo-status-bar`'s `style` is the **icon color**, not the background brightness, so the value is
 * inverted once (dark surface → light icons). If each screen wrote that ternary, one would
 * eventually be written backwards, and the mistake would show up only on that screen.
 *
 * ## Pure — and that is why this file exists
 *
 * This app's tests do not render screens, so if this decision lived in a component, the only way to
 * verify it would be trying it by hand. The brightness classification itself is done by the **same
 * function** web uses (`themeSurfaceScheme` in `@rowcat/design`); what remains here is one line
 * translating that result into this platform's vocabulary. No second luminance formula is created.
 */
export type StatusBarStyle = "light" | "dark";

export function statusBarStyleForBackground(
	background: string,
): StatusBarStyle {
	return themeSurfaceScheme(background) === "dark" ? "light" : "dark";
}
