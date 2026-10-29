import { type ThemePreference, ThemeProvider } from "@rowcat/ui-native";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import {
	type AppearancePreferenceStorage,
	createAppearancePreferenceStore,
} from "./preference.ts";
import { expoAppearanceStorage } from "./sqlite-storage.ts";

/**
 * React wiring for the device appearance preference. No rules live here: read tolerance, the
 * default and write-failure handling are all in `preference.ts`. This file only attaches that store
 * to `ThemeProvider`. (Same split as `activation.ts` and `scope.tsx`: rules inside a component can
 * only be verified on a simulator.)
 *
 * ## `ThemeProvider` sits inside this layer
 *
 * The ownership order is the point of this file:
 *
 * ```text
 * DeviceAppearanceProvider   the brightness the device chose. knows neither identity nor storage
 *   ThemeProvider            that preference → the appearance drawn now
 *     QueryClientProvider
 *       MobileIdentityProvider
 *         ViewerThemeOverride  the colors the account chose
 * ```
 *
 * This layer must sit **outside** identity. That is why the sign-in, loading and error screens have
 * brightness, and why guests see dark screens: placed below identity, all three would always draw
 * light.
 *
 * ## No flicker
 *
 * The initial state is read **synchronously** (inside the `useState` initializer). Reading in an
 * effect would make the first frame always `system`, and someone who chose dark would see a white
 * flash on every launch. If the storage is broken the app still starts, with `system` as the
 * answer; the splash is not held.
 *
 * ## The screen does not wait for the save
 *
 * `setPreference` changes the state first and fires the write. Even if the save fails the screen
 * already shows that brightness, and reverting would cancel the user's choice in front of them.
 */

interface DeviceAppearance {
	preference: ThemePreference;
	setPreference: (preference: ThemePreference) => void;
}

const AppearanceContext = createContext<DeviceAppearance | null>(null);

export function DeviceAppearanceProvider({
	children,
	storage = expoAppearanceStorage,
}: {
	children: ReactNode;
	/** Test and dev-harness hook for a different medium. The product path uses the default. */
	storage?: AppearancePreferenceStorage;
}) {
	const store = useMemo(
		() => createAppearancePreferenceStore(storage),
		[storage],
	);
	/** Initializer function: read once, not on every render, and not after the first frame. */
	const [preference, setValue] = useState<ThemePreference>(() => store.load());

	const setPreference = useCallback(
		(next: ThemePreference) => {
			setValue(next);
			void store.save(next);
		},
		[store],
	);

	const value = useMemo(
		() => ({ preference, setPreference }),
		[preference, setPreference],
	);

	return (
		<AppearanceContext value={value}>
			<ThemeProvider preference={preference}>{children}</ThemeProvider>
		</AppearanceContext>
	);
}

/**
 * The device's chosen brightness and the way to change it.
 *
 * This is a different axis from `useTheme()`. That one answers the **color drawn now** (including
 * the account override); this one answers the **preference a person chose**. The settings screen
 * uses this hook for that reason, and while the value is `system` the fact that the app follows the
 * OS must be expressed.
 */
export function useDeviceAppearance(): DeviceAppearance {
	const value = useContext(AppearanceContext);
	if (!value)
		throw new Error(
			"the appearance can't be read outside DeviceAppearanceProvider",
		);
	return value;
}
