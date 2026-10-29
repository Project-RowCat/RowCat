import type { ColorName, ThemeColorOverrides } from "@rowcat/design";
import {
	type ColorSchemeName,
	type NativeColors,
	nativeColorsFor,
	withAlpha,
} from "@rowcat/design/native";
import { createContext, type ReactNode, useContext, useMemo } from "react";
import { useColorScheme } from "react-native";
import { resolveColorScheme, type ThemePreference } from "./color-scheme.ts";
import { controlSurfacesFor, mergeThemeColors } from "./theme-colors.ts";

export type { ThemePreference };

/**
 * Theme resolution. Preference and scheme are different values:
 * - preference: system | light | dark, the choice the person made
 * - scheme: light | dark, what must be drawn right now
 *
 * If they were folded into one (keeping only the resolved 'dark'), a user following the system
 * would stop following OS changes, because the stored value no longer records that it was following
 * the system. The web ThemeProvider draws the same distinction.
 *
 * Scheme is a subscription, not a snapshot. useColorScheme() is built on React Native's Appearance
 * and re-renders when the OS setting changes, so the app need not restart. That is why this is a
 * hook rather than a value; reading Appearance.getColorScheme() once into a constant would lose
 * updates.
 *
 * app.config.ts sets userInterfaceStyle to 'automatic' so the signal reaches the app. With a fixed
 * value, the hook would answer one way forever.
 *
 * Nothing is persisted here. The provider only receives the preference. Whether it is stored on the
 * device or on the account is a product decision, and no screen for it exists yet. Choosing storage
 * now would lock that decision into this package. The default is `system`, the same as the web.
 */

export interface Theme {
	/** The user's choice. A screen that draws a toggle reads this value. */
	preference: ThemePreference;
	/** The appearance to draw right now. `system` never reaches this point. */
	scheme: ColorSchemeName;
	/** Semantic color table. Keys match the web's CSS variable names (such as `muted-foreground`). */
	colors: NativeColors;
	/**
	 * Semantic color plus opacity, returned as rgba(). Corresponds to the web's bg-destructive/10.
	 *
	 * Used instead of the opacity style because opacity also dims the children. A faint red surface
	 * with solid red text on top is the point of this spot.
	 */
	alpha: (name: ColorName, value: number) => string;
	/**
	 * The field surface: the color the input and the select trigger sit on. The web splits this slot
	 * by appearance, and the measured values are the contract (docs/design/VISUAL-PARITY.md):
	 * - input and SelectTrigger: light transparent, dark input/30
	 *
	 * Native once used input/30 in both appearances, so light mode drew a gray box where the web field
	 * is a white surface with a single border. Both tokens are input, so the source alone looked the
	 * same.
	 *
	 * Light is transparent, not background. With background, a field placed on a card or popover would
	 * cover that surface, while the web's bg-transparent does not. The two tokens are the same color
	 * today, so most places agree, but the code does not rely on that; an account theme could separate
	 * them.
	 *
	 * The branch is on scheme, the same axis as the web. The web's dark: variant checks the document's
	 * .dark class (the appearance), not the effective background. The platform chrome reads the
	 * effective background instead (features/theme/chrome-scheme.ts).
	 */
	fieldSurface: string;
	/**
	 * The surface of outline-only controls: outline buttons and the menu trigger that shows a label.
	 *
	 * It is tempting to merge this with fieldSurface, but the two really differ in light mode:
	 * - Light: background (opaque)
	 * - Dark: input/30
	 *
	 * Opaque in light is the point. The web uses bg-background here because the control must cover
	 * what is behind it (hence shadow-xs as well). Making it transparent would let an outline button
	 * on a faint surface show that surface through it.
	 */
	outlineSurface: string;
}

const ThemeContext = createContext<Theme | null>(null);

/**
 * The color table before account overrides are layered on, exactly as ThemeProvider computed it.
 *
 * This context exists separately because it has one specific consumer. The color-picking screen
 * must show what an emptied slot looks like, and that answer is the default palette, not the
 * override-merged value. Using the merged table as the base would preview the currently saved color
 * in an emptied slot, and the user would read the cleared slot as not cleared.
 *
 * The ThemeColorOverrideProvider deliberately does not override this context. Overriding it would
 * make the two values equal, and this axis would have no reason to exist.
 */
const BaseThemeContext = createContext<Theme | null>(null);

export function ThemeProvider({
	children,
	preference = "system",
}: {
	children: ReactNode;
	preference?: ThemePreference;
}) {
	const scheme = resolveColorScheme(preference, useColorScheme());

	const value = useMemo<Theme>(() => {
		const colors = nativeColorsFor(scheme);
		return {
			preference,
			scheme,
			colors,
			alpha: (name, amount) => withAlpha(colors[name], amount),
			...controlSurfacesFor(scheme, colors),
		};
	}, [preference, scheme]);

	return (
		<BaseThemeContext value={value}>
			<ThemeContext value={value}>{children}</ThemeContext>
		</BaseThemeContext>
	);
}

/**
 * The current theme.
 *
 * Called without a provider, it throws. Silently falling back to the default theme would draw a
 * screen that forgot its provider in light mode. That shows up only as 'this one screen has the
 * wrong colors', often first seen by people using dark mode.
 */
export function useTheme(): Theme {
	const theme = useContext(ThemeContext);
	if (!theme) throw new Error("can only be used inside ThemeProvider");
	return theme;
}

/**
 * Theme before override layers are applied. Used only by the screen where colors are picked.
 *
 * Unlike useTheme(), this returns the unoverridden theme. An ordinary screen that reads it would
 * ignore the account's chosen colors. Calls should be limited to the empty-slot preview, which
 * apps/mobile's static scan enforces by value.
 */
export function useBaseTheme(): Theme {
	const theme = useContext(BaseThemeContext);
	if (!theme) throw new Error("can only be used inside ThemeProvider");
	return theme;
}

/**
 * Applies semantic color overrides on top of the parent theme, without knowing the product.
 *
 * The outer ThemeProvider must stay independent of identity, so login, waiting, and error screens
 * get colors without waiting for auth. Account colors therefore go in a second layer below
 * identity.
 *
 * This component receives an already resolved override table. It does not decide who chose the
 * colors or whether they apply. scheme and preference are inherited from the parent unchanged,
 * since a second light/dark decision would miss OS changes.
 *
 * alpha() reads the merged palette. Otherwise alpha('primary', 0.1) would blend the default purple
 * instead of the custom primary, a mismatch visible only on faint backgrounds. boundaries.test.ts
 * enforces the package boundary.
 */
export function ThemeColorOverrideProvider({
	children,
	overrides,
}: {
	children: ReactNode;
	overrides?: ThemeColorOverrides;
}) {
	const parent = useTheme();

	const value = useMemo<Theme>(() => {
		const colors = mergeThemeColors(parent.colors, overrides);
		/**
		 * When the merge returns the same reference, there are no overrides, so the parent object is
		 * passed through.
		 *
		 * A new object on every render would re-render the whole subtree below this layer. That cost
		 * would fall on users who never chose colors, which is most users.
		 */
		if (colors === parent.colors) return parent;

		return {
			preference: parent.preference,
			scheme: parent.scheme,
			colors,
			alpha: (name, amount) => withAlpha(colors[name], amount),
			/**
			 * Built from the merged table. Inheriting the parent's values would leave the control surfaces
			 * on the default palette when the account overrides `input`.
			 */
			...controlSurfacesFor(parent.scheme, colors),
		};
	}, [parent, overrides]);

	return <ThemeContext value={value}>{children}</ThemeContext>;
}
