import { resolveEffectiveThemeOverrides } from "@rowcat/design";
import {
	effectiveThemeSelection,
	themeCustomizationQueryOptions,
} from "@rowcat/query";
import { ThemeColorOverrideProvider } from "@rowcat/ui-native";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useMemo } from "react";
import { getRowCatClient } from "../../lib/api.ts";
import { useMobileIdentity } from "../../lib/identity.tsx";

/**
 * The only place the account theme is applied to this app's color table. Screens do nothing here.
 *
 * ## Two layers
 *
 * ```text
 * presets        `default` · `White` · `Gray` · `Black`     below
 * custom colors  background · surface · accent          above
 * ```
 *
 * On the web, a member who picks `Black` sees a black screen in this app too. This app does not
 * restate the preset color values, for the same reason: the table belongs to `@rowcat/design`, and
 * both apps call the same function. A copy would make the web's `Black` and this app's `Black` slightly
 * different blacks.
 *
 * ## This layer only applies — the editor belongs to the settings screen
 *
 * This app also has a theme editor (the theme section of `/settings`: four presets and three custom
 * solid colors). What is absent here is the form, not the feature. The reason for the split is
 * lifetime: if the editor started painting colors directly, colors would either reset when the user
 * leaves the settings screen, or two layers would paint different values. So this file contains no
 * writes; once a save is confirmed, it changes by observing the `@rowcat/query` cache. The rule
 * against placing preset cards on the account screen still holds (`/account` is for what the
 * account owns, not for settings).
 *
 * **Only the background gradient does not reach this app.** No layer here renders it (only the
 * solid reference point is used), so it is neither drawn nor edited. But the editor's save does not
 * erase it either: color writes replace the whole value, so if the draft did not carry that value
 * through, a save here that changed one color would erase a gradient made on the web
 * (`features/settings/theme-customization-state.ts`).
 *
 * This layer comes first anyway because of the value's nature: presets and custom colors are both
 * **account** values, so a choice made on the web must apply here too for the same account. Not
 * creating a second store is the structural form of that promise, which is why this file has no
 * SQLite and no AsyncStorage. The server-state channel is `@rowcat/query` alone.
 *
 * ## The external appearance (light/dark) is not part of this layer
 *
 * There is a single palette, so custom-color resolution takes no appearance input. When the OS
 * changes appearance, what changes is the parent `ThemeProvider`'s default table; this layer's
 * overrides stay on top, so the chosen cells remain while the others change. If this file started
 * reading `scheme`, the "custom colors depend on appearance" axis would return, and that is a model
 * we removed.
 *
 * ## Inside the base appearance
 *
 * ```text
 * ThemeProvider              base appearance. Independent of identity — the login, waiting and error screens use it
 *   QueryClientProvider
 *     MobileIdentityProvider "whose app is this"
 *       ViewerThemeOverride  ← here. The account's colors
 *         ViewerScopedLocalData
 *           ThemedChrome     the status bar and stack-transition background read the effective color
 * ```
 *
 * The last line matters. If `ThemedChrome` sat outside this layer, the screen would have a custom
 * background while the default background flashed for a frame on every navigation. That mismatch
 * shows only during transitions.
 *
 * ## Failure means the default colors
 *
 * If the query fails or the viewer is a guest, the override is as if absent: the parent table
 * passes through and the app draws as usual. This value is decoration and has no authority to halt
 * a screen, so it draws neither a loading state nor an error state.
 */
export function ViewerThemeOverride({ children }: { children: ReactNode }) {
	const { session } = useMobileIdentity();

	/**
	 * Asks only confirmed members. Guests and unconfirmed sessions (including `unavailable`) never run
	 * the query. It is a private resource, so there is no reason for a 401 round trip, and above all
	 * no reason for that round trip to interfere with the first render of a public screen.
	 */
	const viewerId = session.viewer?.id ?? null;

	const { data } = useQuery({
		...themeCustomizationQueryOptions(getRowCatClient()),
		enabled: viewerId !== null,
		/** This layer reads only one value, so it has no reason to re-render on every query state change. */
		notifyOnChangeProps: ["data"],
	});

	/**
	 * The condition for applying overrides is owned by one shared predicate (`@rowcat/query`), which
	 * the web calls too. With no viewer there are no overrides, and that condition turns false
	 * **before** the query cache is cleared, so there is no window where the previous person's theme
	 * survives an account switch.
	 */
	const overrides = useMemo(() => {
		/**
		 * Presets come first and custom colors after: order is priority, and the shared resolver owns
		 * that rule. Pass the whole selection; rebuilding it from fields would become a second judgment.
		 */
		const resolved = resolveEffectiveThemeOverrides(
			effectiveThemeSelection(data, viewerId),
		);
		/**
		 * Collapses an empty table to `undefined`. Passing `{}` through would still work (the merge
		 * counts keys and returns the parent table), but that decision should not live in two places.
		 */
		return Object.keys(resolved).length > 0 ? resolved : undefined;
	}, [viewerId, data]);

	return (
		<ThemeColorOverrideProvider overrides={overrides}>
			{children}
		</ThemeColorOverrideProvider>
	);
}
