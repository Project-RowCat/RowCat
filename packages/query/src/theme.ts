import type {
	ThemeCustomizationDto,
	ThemeCustomizationStateDto,
	ThemeCustomizationUpdateRequest,
	ThemePreset,
} from "@rowcat/contracts";
import { DEFAULT_THEME_PRESET } from "@rowcat/contracts";
import type { RowCatClient } from "@rowcat/sdk";
import {
	mutationOptions,
	type QueryClient,
	queryOptions,
} from "@tanstack/react-query";
import { retryUnlessClientError } from "./retry.ts";

/**
 * Server state of the account theme: the query key, and the cache policy of four writes.
 *
 * The key sits under ['viewer', ...], and that placement matters most in this file. Logout and
 * login cleanup already own that prefix (viewer.ts). A global key (['theme']) would escape that
 * cleanup, and the symptom would be Bob's screen showing Alice's colors on a shared browser.
 * Notifications sit in the same place for the same reason.
 *
 * The member id is not put in the key either. It would let the previous person's slot survive under
 * a different key that the prefix cleanup cannot clear.
 */

/** One prefix covers both the query and the four writes. The viewer reset uses it. */
export const THEME_CUSTOMIZATION_QUERY_KEY = [
	"viewer",
	"theme-customization",
] as const;

/**
 * Preset plus saved colors. staleTime is five minutes. Only the user changes this value (saving on
 * another device, or here), and in both cases the mutation seats the confirmed value in the cache,
 * so it does not need asking often in the background.
 *
 * No periodic refetch. The repository's promise that an idle app makes no requests is not broken
 * for a decoration.
 */
export function themeCustomizationQueryOptions(client: RowCatClient) {
	return queryOptions<ThemeCustomizationStateDto>({
		queryKey: THEME_CUSTOMIZATION_QUERY_KEY,
		queryFn: ({ signal }) => client.theme.get({ signal }),
		staleTime: 300_000,
		retry: retryUnlessClientError,
	});
}

/**
 * The account theme actually applied right now: the preset and the custom colors. Both apps call
 * this one function, so the decision is not written twice. No viewer means no preset and no colors,
 * and unknown state (load failure, offline, guest) maps to the same empty result.
 *
 * The no-viewer case matters most: the viewer becomes null before the query cache is cleared, so
 * Alice's theme cannot remain on Bob's screen in between. A third case, keeping the preset while
 * the colors stop when the Cattower entitlement is missing, was removed with the entitlement check in
 * the public build (docs/oss/PLAN.md, section 3).
 *
 * The device appearance (light or dark) is not part of this decision. The palette is single, so the
 * result does not depend on appearance; appearance only changes the remaining default tokens.
 *
 * Colors are not resolved here. This package does not depend on @rowcat/design, and building an
 * override table here would leak design-token vocabulary into the query layer. The app passes this
 * result to resolveEffectiveThemeOverrides unchanged.
 */
export interface EffectiveThemeSelection {
	preset: ThemePreset;
	customization: ThemeCustomizationDto;
}

/**
 * The shared instance for 'no colors to apply'. It is not a fresh {} per call because consumers use
 * it as a useEffect or useMemo dependency: a new object each time would rerun those effects every
 * render, and on web that means erasing and rewriting the document's custom properties.
 *
 * Freezing makes the sharing safe as a value. If a consumer mutated this object in place, every
 * member would have that color from then on.
 */
const NO_CUSTOM_COLORS: ThemeCustomizationDto = Object.freeze({});

export function effectiveThemeSelection(
	state: ThemeCustomizationStateDto | undefined,
	viewerId: string | null,
): EffectiveThemeSelection {
	if (!viewerId || !state)
		return { preset: DEFAULT_THEME_PRESET, customization: NO_CUSTOM_COLORS };

	return { preset: state.preset, customization: state.customization };
}

/**
 * Seats the normalized state the server returned straight into the cache. Invalidation alone would
 * keep drawing the old colors until refetch, and the user would read their just-pressed save as
 * doing nothing. The response already holds the authoritative value, so no round trip is needed
 * (the payment mutation response made the same call). No slot is created: setQueryData would create
 * an entry without an observer, and such a value would look present without ever being asked of the
 * server.
 */
function applyThemeState(
	queryClient: QueryClient,
	state: ThemeCustomizationStateDto,
): void {
	queryClient.setQueryData<ThemeCustomizationStateDto>(
		THEME_CUSTOMIZATION_QUERY_KEY,
		(current) => (current === undefined ? current : state),
	);
}

/**
 * Picks a preset. No optimistic update, for the same reason as colors: a falsehood drawn briefly is
 * 'this preset was saved', and on failure the screen flips once and reverts. The preset response is
 * immediate (the same round trip as the color write), so there is no rollback to build for those
 * milliseconds.
 *
 * The saved custom colors are not touched: the response carries them back and the whole response is
 * seated.
 */
export function saveThemePresetMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
) {
	return mutationOptions<ThemeCustomizationStateDto, Error, ThemePreset>({
		/**
		 * All four writes share the same scope. If they overlap, the response that arrives later wins.
		 */
		scope: { id: "theme-customization" },
		mutationFn: (preset) => client.theme.savePreset(preset),
		onSuccess: (state) => applyThemeState(queryClient, state),
	});
}

/**
 * Saves custom colors. This is a replacement, with no optimistic update. The falsehood drawn
 * briefly would be 'this color was saved', and the server may reject it on re-checking the syntax.
 * Painting optimistically would show the color changing and reverting, with no way for the user to
 * know what is true. The chosen preset is not touched: the response carries it back.
 */
export function saveThemeColorsMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
) {
	return mutationOptions<
		ThemeCustomizationStateDto,
		Error,
		ThemeCustomizationUpdateRequest
	>({
		scope: { id: "theme-customization" },
		mutationFn: (customization) => client.theme.saveColors(customization),
		onSuccess: (state) => applyThemeState(queryClient, state),
	});
}

/** Clears only the custom colors and keeps the preset. */
export function clearThemeColorsMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
) {
	return mutationOptions<ThemeCustomizationStateDto, Error, void>({
		scope: { id: "theme-customization" },
		mutationFn: () => client.theme.clearColors(),
		onSuccess: (state) => applyThemeState(queryClient, state),
	});
}

/**
 * Full reset, back to no preset and no colors. Sharing the same scope is the point: if a save and a
 * reset ran in parallel, the response that arrives later would win, and the network would decide
 * the order.
 */
export function resetThemeMutationOptions(
	client: RowCatClient,
	queryClient: QueryClient,
) {
	return mutationOptions<ThemeCustomizationStateDto, Error, void>({
		scope: { id: "theme-customization" },
		mutationFn: () => client.theme.reset(),
		onSuccess: (state) => applyThemeState(queryClient, state),
	});
}
