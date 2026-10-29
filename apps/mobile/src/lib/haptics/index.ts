import { Platform, TurboModuleRegistry } from "react-native";
import type { Pattern } from "react-native-pulsar";
import { HAPTIC_PATTERNS, type HapticCue } from "./patterns.ts";

/**
 * The only door for haptics: the one file in this app that knows `react-native-pulsar`.
 *
 * ```text
 * feature code   useHapticCue("generationDone") · haptics.selection()   meaning names only
 * this file      loads Pulsar lazily; does nothing if not iOS or not linked
 * patterns       values (strength, sharpness, length), pure data
 * ```
 *
 * ## iOS only, by decision
 *
 * Pulsar supports Android, but it stays off there. Motor strength varies widely between Android
 * devices, so one pattern can feel like a round tap on one device and a buzz on another. A feel we
 * cannot tune is a cheap feel. Android is therefore excluded from autolinking
 * (`expo.autolinking.android.exclude` in `package.json`), and the `Platform` check here blocks it a
 * second time. The intended web/native difference is listed in `docs/motion/ARCHITECTURE.md`.
 *
 * ## Lazy loading
 *
 * Pulsar's JS calls `TurboModuleRegistry.getEnforcing` at load time, and on a binary where the
 * module is not linked that call **throws**. A top-level import would crash, at app start, any dev
 * client built before this dependency existed, and the failure would appear on screens unrelated to
 * haptics (`rowcat-runtime-webview` has the same shape for the same reason). So we first ask with
 * `get` (which does not throw) and require only when present. The `import type` above is erased;
 * the value enters only through the `require` below.
 *
 * ## Never call `Settings`, especially `enableSound`
 *
 * In debug builds Pulsar mimics patterns with sound, switching the shared audio session category to
 * active (release builds leave the session alone). Calling `Settings.enableSound(false)` to silence
 * that deactivates the shared session (`setActive(false, .notifyOthersOnDeactivation)`), which cuts
 * the managed audio of creator runtimes (`expo-audio`) playing on it. The debug sound is also how
 * patterns can be auditioned in the simulator. A static scan keeps this absence
 * (`haptics-boundaries.test.ts`).
 *
 * ## Failure is silent, by design
 *
 * A haptic that does not fire is not something the user lost. The decision has already been made
 * and the screen already drawn. Throwing here would let an auxiliary signal break the cleanup of
 * that decision.
 */

type PulsarModule = typeof import("react-native-pulsar");

let pulsarCache: PulsarModule | null | undefined;

function pulsar(): PulsarModule | null {
	if (pulsarCache !== undefined) return pulsarCache;
	pulsarCache = null;
	if (Platform.OS !== "ios") return pulsarCache;
	if (!TurboModuleRegistry.get("RNPulsar")) return pulsarCache;
	try {
		pulsarCache = require("react-native-pulsar") as PulsarModule;
	} catch {
		// Linked, but the JS side failed to load. See "Failure is silent" in the header.
	}
	return pulsarCache;
}

const silent = () => {};

/**
 * Returns a function that plays this app's pattern for `cue`.
 *
 * A hook because Pulsar's pattern composer is a hook: the pattern is parsed once up front
 * (`parse`), and each play passes only an index. The parse is released when the screen unmounts.
 *
 * Runs without Pulsar (Android, unlinked builds) do not call the hook. That branch comes from
 * `pulsar()`'s cache, which is fixed for the process lifetime, so one component never calls a
 * varying number of hooks across renders.
 */
export function useHapticCue(cue: HapticCue): () => void {
	const module = pulsar();
	if (!module) return silent;
	/**
	 * `HapticPattern` and Pulsar's `Pattern` have the same shape. Our own type exists so that
	 * `patterns.ts` stays free of this dependency and can enter the test graph. The table values are
	 * module constants, so the reference is the same across renders and the parse happens once.
	 */
	const pattern: Pattern = HAPTIC_PATTERNS[cue];
	// biome-ignore lint/correctness/useHookAtTopLevel: the branch is fixed for the process lifetime (see the comment above).
	return module.usePatternComposer(pattern).play;
}

/**
 * System patterns, for meanings the OS has already taught.
 *
 * The `selection` played when a value is picked is the same feel UIKit's picker produces. Replacing
 * it with our own pattern would not make it distinctive; it would only make this app feel different
 * in a way users cannot place.
 */
export const haptics = {
	selection: () => {
		pulsar()?.Presets.System.selection();
	},
};
