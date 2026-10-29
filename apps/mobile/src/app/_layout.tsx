/**
 * App root. Two orderings matter: load order and ownership order.
 *
 * `secure-random` loads first. It installs `crypto.getRandomValues`, which all key material in the
 * shared sync package comes from; a module evaluated before it would use weak randomness or throw.
 * Import sorting is automatic here, so `SECURE_RANDOM_READY` is actually read: a used value keeps
 * the sorter and the tree-shaker from moving or dropping that import.
 *
 * ```text
 * DeviceAppearanceProvider     device-chosen brightness + ThemeProvider; identity-independent, outermost
 *   SelectionFeedbackProvider  haptics on value selection; asks for neither identity nor storage
 *   UpdateNotesProvider        seen-state of release notes; a device value, so outside identity
 *     QueryClientProvider      server-state cache
 *       MobileIdentityProvider whose app is this: /v2/me answers
 *         ViewerThemeOverride  the account's saved colors; a no-op when none
 *           ViewerScopedLocalData  opens SQLite with that answer's member id
 *             MobileSyncRuntimeProvider
 *               [entry gate]   age, guardian consent; while it stands nothing below mounts
 *               Stack          screens
 * ```
 *
 * - The notes container sits just inside brightness because the seen fact belongs to the device,
 *   not the account (switching accounts must not make the same note new again), and because the
 *   header's notification shortcut and the notifications screen's tab must read the same value;
 *   per-screen containers would leave one dot stale until relaunch.
 * - The entry gate is innermost because its exits are sign-out and account deletion, and deletion
 *   clears per-member SQLite, SecureStore and the query cache, so a gate above those owners could
 *   not call that cleanup. Inside a route it would be one gate per route, and a missed route opens
 *   with no error.
 * - The theme is split in two: the default appearance stays outermost (login, waiting and error
 *   screens use it), and only the account's colors layer on under identity. Merging them below
 *   authentication would draw those three screens without colors.
 * - Identity is above storage; reversed, the code that opens storage would ask for login state
 *   itself and "who is this" would have two answers.
 *
 * ## Floating layers are behind the navigator
 *
 * `PortalOutlet` is where anchored menus, dialogs, confirmations and sheets are drawn. It must come
 * after the navigator to be drawn on top, which is invisible in code: swapping them still compiles
 * and the symptom is an opened layer that shows nothing.
 */

import {
	PortalOutlet,
	SelectionFeedbackProvider,
	useTheme,
} from "@rowcat/ui-native";
import { QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import {
	AppGatePanel,
	useAppGate,
} from "../features/onboarding/membership-gate.tsx";
import { MobilePushProvider } from "../features/push/push-provider.tsx";
import { statusBarStyleForBackground } from "../features/theme/chrome-scheme.ts";
import { ViewerThemeOverride } from "../features/theme/viewer-theme-override.tsx";
import { UpdateNotesProvider } from "../features/updates/update-notes-provider.tsx";
import { DeviceAppearanceProvider } from "../lib/appearance/provider.tsx";
import { useProductFonts } from "../lib/fonts.ts";
import { haptics } from "../lib/haptics/index.ts";
import {
	MobileIdentityProvider,
	ViewerScopedLocalData,
} from "../lib/identity.tsx";
import { MobileSyncRuntimeProvider } from "../lib/local-sync/provider.tsx";
import { createMobileQueryClient } from "../lib/query.ts";
import { SECURE_RANDOM_READY } from "../lib/secure-random.ts";

if (!SECURE_RANDOM_READY) throw new Error("the CSPRNG wiring wasn't loaded");

export default function RootLayout() {
	// Created once at the root: per-render creation discards the cache every time, and a module global
	// keeps the previous person's values across account switches.
	const queryClient = useMemo(() => createMobileQueryClient(), []);

	// Product fonts: does not wait for loading. The value is deliberately not read, because blocking
	// on `loaded` leaves a blank stretch on launch that the web does not have (`font-display: swap`).
	// The hook re-renders on load, and an unknown `fontFamily` falls back to the system font. Called
	// at the root so every screen sees the product font.
	useProductFonts();

	return (
		// Device-chosen brightness, outermost; `ThemeProvider` inside resolves the preference to the
		// appearance to draw (`lib/appearance/provider.tsx` stands both). It sits outside identity so
		// login, waiting and error screens (and guests) get dark mode, and its value lives in the device
		// key-value store rather than per-member SQLite.
		<DeviceAppearanceProvider>
			{/* Selection haptics sit outside identity because select controls also appear on login,
			    waiting and error screens. `lib/haptics` decides what vibrates; `@rowcat/ui-native` only
			    knows the moment. */}
			<SelectionFeedbackProvider onSelectionChange={haptics.selection}>
				{/* Seen-state of release notes, outside identity (see the tree above). Mounting opens
				    nothing: a window once opened on launch and was removed because a release note is
				    neither consent nor confirmation, and making it a gate turns information into a block.
				    The only way to open one is a row a person presses. */}
				<UpdateNotesProvider>
					<QueryClientProvider client={queryClient}>
						<MobileIdentityProvider>
							{/* Second theme layer carrying the account's saved colors. The outer `ThemeProvider` is
							    not moved here because the default appearance must not depend on identity; with
							    no override this layer passes the parent theme through (guest, no saved colors,
							    failed lookup). `ThemedChrome` lives inside it, or a default background would
							    flash for one frame on every transition. */}
							{/* Push wiring stands at the root: a per-screen listener would miss banners pressed
							    while that screen is unmounted or while the app was dead (same reasoning as
							    the update-notes container). It raises no system prompt; permission is asked
							    only when the user turns on `Push notifications` in settings, and this layer only
							    refreshes the registration of an already-allowed device. It is inside identity
							    because registration binds to the account and must be forgotten on switch. */}
							<MobilePushProvider>
								<ViewerThemeOverride>
									<ViewerScopedLocalData>
										{/* Sync runtime: below the per-member local scope, above screens. One runtime per
										    scope and screens only read, so sync runs on start, foreground and reconnect
										    without opening the account screen. */}
										<MobileSyncRuntimeProvider>
											<ThemedChrome />
										</MobileSyncRuntimeProvider>
									</ViewerScopedLocalData>
								</ViewerThemeOverride>
							</MobilePushProvider>
						</MobileIdentityProvider>
					</QueryClientProvider>
				</UpdateNotesProvider>
			</SelectionFeedbackProvider>
		</DeviceAppearanceProvider>
	);
}

/**
 * Where the theme reaches outside the screens: the status bar text color and the native stack's
 * floor drawn during transitions. Both render outside the React tree, so a screen's `Screen`
 * background does not cover them; missing it flashes a black band between screens on light themes.
 *
 * The icon color comes from the effective background, not `scheme`. `scheme` is the device
 * appearance while `colors.background` already carries the account theme, so they diverge when the
 * account overrides the background (device light + black preset gave black icons on black). The
 * rule lives in a pure module (`features/theme/chrome-scheme.ts`) because this app's tests do not
 * render screens. Not reading `scheme` here is the structural form of that.
 */
function ThemedChrome() {
	const { colors } = useTheme();
	// Entry gate: decided here because it splits the whole app, not a route; a per-screen gate misses
	// any route added later and that route opens with no error. The decision is one pure function
	// (`features/onboarding/membership-gate-state.ts`); this only picks what to draw.
	const gate = useAppGate();

	return (
		<View style={[chrome.root, { backgroundColor: colors.background }]}>
			<StatusBar style={statusBarStyleForBackground(colors.background)} />
			{/* The gate replaces the navigator rather than covering it. A layer above `<Stack>` leaves
			    product screens alive underneath (effects run, queries go out, dialogs open, assistive
			    tech reads them; on the web keyboard users got trapped that way). Here `<Stack>` is not
			    mounted, so no hand-typed route has a screen to draw. */}
			{gate ? (
				<AppGatePanel gate={gate} />
			) : (
				/*
				 * No update-note window stands here. One used to open automatically on launch and was removed
				 * because a release note is neither consent nor confirmation; the notifications screen's `Updates`
				 * tab now draws the history and a new note is only a dot (`docs/updates/ARCHITECTURE.md`). The
				 * `app_update` notification is unaffected.
				 *
				 * `PageEnter` is the single layer that says a screen arrived:
				 *
				 * ```text
				 * stack       animation: "none"   swaps position only, choreographs nothing
				 * PageEnter   one body layer      opacity 0 → 1 · translateY 4 → 0
				 * ```
				 *
				 * `"none"` is decided from on-device frames. An older note claimed turning the push off makes
				 * the iOS edge swipe drag a frozen screen; that is false on this version (react-native-screens
				 * 4.26.2, iOS 27). In `RNSScreenStack.mm`'s `gestureRecognizerShouldBegin`, without
				 * `customAnimationOnSwipe` the check falls to the system
				 * `_UIParallaxTransitionPanGestureRecognizer` branch, which returns true regardless of
				 * `stackAnimation`. The gesture's lifetime is set by `gestureEnabled`, not this value.
				 *
				 * `"fade"` was a candidate and was dropped by observation: on a full-screen stack it is a
				 * cross-dissolve of two screens, so two headers, the search field and the category row overlap
				 * for over 100ms, which the web never shows (its shell stays and only the canvas changes). With
				 * `"none"` the frame is opaque from the first frame and only the body moves, the same structure
				 * as the web.
				 *
				 * `PageEnter` therefore runs unconditionally. Its old "only late-arriving bodies" rule existed
				 * to avoid overlapping the push; with no push, keeping it would drop arrival for warm-cache
				 * screens only and diverge from the web.
				 *
				 * Not done here: keying the outlet by path, wrapping it in presence, or holding the leaving
				 * screen (each re-creates route identity and lifetime, shaking scroll restoration, focus and
				 * local screen state), and not disabling the gesture. `lib/motion/route-motion.test.ts` pins
				 * both absences by value.
				 */
				<Stack
					screenOptions={{
						headerShown: false,
						// `PageEnter` is the one arrival layer; a platform push here would put two transitions on one
						// event.
						animation: "none",
						contentStyle: { backgroundColor: colors.background },
					}}
				/>
			)}
			{/* Must come after the layer above to draw on top. It is needed while the gate stands too:
			    account deletion's confirmation exits through here. */}
			<PortalOutlet />
		</View>
	);
}

const chrome = StyleSheet.create({ root: { flex: 1 } });
