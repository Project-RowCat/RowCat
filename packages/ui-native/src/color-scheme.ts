import type { ColorSchemeName } from "@rowcat/design/native";

/**
 * Resolves the user's preference and the OS-reported scheme into the appearance to draw. Lives in
 * its own file, not theme.tsx: theme.tsx imports react-native, which the test runner cannot load
 * (react-native/index.js is Flow syntax the parser rejects; apps/mobile/vitest.config.ts makes the
 * same call). If the rule lived inside a hook, the only check would be manual, and how a null OS
 * answer folds would be invisible.
 */

export type ThemePreference = "system" | ColorSchemeName;

export function resolveColorScheme(
	preference: ThemePreference,
	/**
	 * The OS-reported type is wide on purpose: the vocabulary belongs to the platform. React Native
	 * can answer null, undefined or 'unspecified', and that list is not ours to define. Only one fact
	 * is known here: anything other than 'dark' is not dark.
	 */
	system: string | null | undefined,
): ColorSchemeName {
	if (preference !== "system") return preference;
	/**
	 * Folds everything that is not dark to light, matching what the web draws when no media query
	 * applies.
	 */
	return system === "dark" ? "dark" : "light";
}
