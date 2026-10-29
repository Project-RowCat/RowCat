import {
	resolveEffectiveThemeGradient,
	resolveEffectiveThemeOverrides,
} from "@rowcat/design";
import {
	effectiveThemeSelection,
	themeCustomizationQueryOptions,
	viewerQueryOptions,
} from "@rowcat/query";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { getRowCatClient } from "#/lib/api.ts";
import {
	applyAccountBackgroundGradient,
	clearAccountBackgroundGradient,
} from "#/lib/theme/background-gradient.ts";
import {
	applyAccountChromeScheme,
	clearAccountChromeScheme,
} from "#/lib/theme/chrome-scheme.ts";
import {
	applyThemeColorOverrides,
	clearThemeColorOverrides,
} from "#/lib/theme/color-overrides.ts";

/**
 * Sole owner of applying the account theme to the document root. Renders nothing.
 *
 * - Applied once, at the root. In the settings screen the colors would vanish when that screen is
 *   left. In the app shell or preamble they would not apply on screens without that shell (login,
 *   the guardian consent page). With several mount points, mount order would decide the winner.
 * - Two layers: presets (default, white, gray, black) first, then free colors (background,
 *   surface, accent, and a gradient) on top. The precedence rule lives in
 *   resolveEffectiveThemeOverrides.
 * - Color resolution takes no light/dark scheme. The palette is single. Device appearance only
 *   changes tokens the account does not override (the :root and .dark blocks in tokens.css).
 *   Passing a scheme in would revive the removed model, where custom colors follow the OS.
 * - The background gradient is a separate axis (--account-background-image). Semantic color
 *   tokens must stay opaque #rrggbb: a gradient there is silently ignored by CSS, which makes many
 *   surfaces transparent. The gradient string is built in lib/theme/background-gradient.ts.
 * - Platform chrome (scrollbars, default form controls) is a further axis. It falls back to the
 *   device appearance when the page background is overridden. That decision reads a solid reference
 *   color; the final value is computed in lib/theme/chrome-scheme.ts. This file only reports its
 *   own axis.
 * - Never toggles the root .light/.dark class. That would swap every remaining semantic token to
 *   another palette and merge the device preference with the account palette.
 * - Failure (query error or offline) means no overrides, so the default RowCat colors show. The
 *   app must not become an error screen over decoration. Retry lives in the settings section.
 * - First paint uses default colors. The value is private server state that cannot be read before
 *   hydration. Caching it in unscoped localStorage would leak one account's colors and presets to
 *   the next user of the browser. The light/dark FOUC guard stays, since that value is
 *   device-local. A member-scoped cache should be designed only if the delay becomes a real
 *   problem. Isolation should not be undone to fix it.
 */
export function AccountThemeBridge() {
	const client = getRowCatClient();

	/**
	 * Reads the viewer identity directly so the theme query can be gated with `enabled`. Guests must
	 * never trigger the private resource request, since public screens would otherwise make a 401
	 * round trip.
	 */
	const viewerId =
		useQuery({ ...viewerQueryOptions(client), notifyOnChangeProps: ["data"] })
			.data?.id ?? null;

	const { data } = useQuery({
		...themeCustomizationQueryOptions(client),
		enabled: viewerId !== null,
		/**
		 * This layer reads only the data value, so it should not re-render on every query state change.
		 */
		notifyOnChangeProps: ["data"],
	});

	/**
	 * The apply condition is owned by one shared predicate in `@rowcat/query`. Mobile calls the same
	 * function on purpose. If each app wrote its own, one could drop a condition, and the mismatch
	 * would show up as another account's colors lingering in only that app.
	 */
	const selection = useMemo(
		() => effectiveThemeSelection(data, viewerId),
		[data, viewerId],
	);

	useEffect(() => {
		const root = document.documentElement;
		/**
		 * Presets come first and free colors after. That order is the precedence, and the rule belongs to
		 * the shared resolver, not this file. The whole selection is passed in, because rebuilding it
		 * from individual fields would create a second place where the decision is made.
		 *
		 * The useMemo around the selection is part of that decision. A new object on every render would
		 * re-run this effect on every render, and the effect clears and rewrites the document's custom
		 * properties each time. Members without overrides would pay that cost too.
		 */
		const overrides = resolveEffectiveThemeOverrides(selection);
		applyThemeColorOverrides(root, overrides);
		/**
		 * The background gradient is a separate axis, so it is applied separately. Mixing it into the
		 * color map would turn `--background` into an image, and every place that reads that token as a
		 * color would silently become transparent. resolveEffectiveThemeGradient takes the same selection
		 * as the color map.
		 */
		applyAccountBackgroundGradient(
			root,
			resolveEffectiveThemeGradient(selection),
		);
		/**
		 * The same map is also passed to the chrome layer. Deriving the background here would add a
		 * second composition rule. Combinations such as the black preset with an active white background
		 * would paint colors and scrollbar appearance differently.
		 */
		applyAccountChromeScheme(root, overrides);
		/**
		 * Cleanup clears everything, including the account axes. The component is practically never
		 * unmounted, but if that changes, leftovers would surface later as stale styling.
		 *
		 * The chrome axis matters most. Each selection change runs cleanup before apply (for example from
		 * `Black` to `Default`). If the account axis is not cleared here, a member who switches back to the
		 * default preset keeps the previous preset's scrollbar appearance. Logout and account switching
		 * take the same path.
		 */
		return () => {
			clearThemeColorOverrides(root);
			clearAccountBackgroundGradient(root);
			clearAccountChromeScheme(root);
		};
	}, [selection]);

	return null;
}
