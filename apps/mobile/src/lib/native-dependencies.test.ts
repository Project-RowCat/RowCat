import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Checks that the Reanimated and Worklets pair is one Expo SDK can ship.
 *
 * This exists because of a concrete incident. Bumping `react-native-reanimated` 4.5.1 → 4.6.0 pulls
 * its peer `react-native-worklets` 0.10.x → 0.12.x, and 0.12 removed `WorkletRuntime::executeSync`,
 * which Expo SDK 57's `expo-modules-core` calls (iOS build error in
 * `ExpoWorkletsBridgeProvider.mm`).
 *
 * That failure has no JS symptom: types, tests and `expo export` pass, and an installed Debug
 * binary still runs, because `pod install` only runs when a native build is made. The bump looked
 * like an ordinary diff in review, and the break only surfaced when a Release build was attempted.
 *
 * The check does not pin version numbers. Pinning `4.5.1` as a literal would block SDK upgrades. It
 * checks a relationship instead:
 *
 * ```text
 * 1. the pinned version == the version the installed Expo SDK says it bundles
 * 2. that worklets version is inside the peer range declared by expo-modules-core
 * ```
 *
 * Both answers come from the installed Expo SDK, so an SDK upgrade with a wider range follows
 * automatically. Upgrading Reanimated alone while keeping the SDK fails check 1 first.
 */

const MOBILE = fileURLToPath(new URL("../../", import.meta.url));

const json = (path: string): Record<string, unknown> =>
	JSON.parse(readFileSync(`${MOBILE}${path}`, "utf8"));

const manifest = json("package.json");
const pinned = manifest.dependencies as Record<string, string>;

/** Single source of truth for native module versions Expo verified with this SDK. */
const bundled = json("node_modules/expo/bundledNativeModules.json") as Record<
	string,
	string
>;

/** If this pair diverges, native breaks. That fact is the entire reason for this list. */
const PAIRED = ["react-native-reanimated", "react-native-worklets"] as const;

describe("native module versions", () => {
	it.each(PAIRED)("%s is the same version this SDK ships", (name) => {
		/**
		 * No caret or tilde ranges: `^4.5.1` floats up to 4.6.0, and that drift is the incident described
		 * above.
		 */
		expect(pinned[name]).toBe(bundled[name]);
	});
});

/**
 * Only reads caret lists such as `^0.7.4 || ^0.8.0`, which is the format used here. If the format
 * changes, the checks below fail with "cannot read" first instead of passing silently.
 */
function caretAlternatives(
	range: string,
): { major: number; minor: number; patch: number }[] {
	return range.split("||").map((part) => {
		const matched = part.trim().match(/^\^(\d+)\.(\d+)\.(\d+)$/);
		if (!matched) throw new Error(`not a caret list: ${part.trim()}`);
		return {
			major: Number(matched[1]),
			minor: Number(matched[2]),
			patch: Number(matched[3]),
		};
	});
}

function admits(range: string, version: string): boolean {
	const [major, minor, patch] = version.split(".").map(Number);
	return caretAlternatives(range).some((low) => {
		if (low.major !== major) return false;
		/** `^0.x.y` is pinned to 0.x; for major 0, the minor version is the compatibility boundary. */
		if (major === 0) return low.minor === minor && patch >= low.patch;
		return minor > low.minor || (minor === low.minor && patch >= low.patch);
	});
}

describe("expo-modules-core's peer range", () => {
	/**
	 * Asks Node for the path instead of hard-coding it. `apps/mobile` does not declare this package
	 * directly, and pnpm gives a peer-resolved transitive dependency a different name per peer
	 * resolution (`expo-modules-core@57.0.14_react-native-worklets@0.10.1_…`). A hard-coded path would
	 * fail with "file not found" when that name changes, which is not the question this check asks.
	 */
	const core = JSON.parse(
		readFileSync(
			createRequire(
				createRequire(`${MOBILE}package.json`).resolve("expo/package.json"),
			).resolve("expo-modules-core/package.json"),
			"utf8",
		),
	) as Record<string, unknown>;
	const peers = (core.peerDependencies ?? {}) as Record<string, string>;
	const range = peers["react-native-worklets"];

	it("declares a worklets peer range", () => {
		/**
		 * An optional peer: installs succeed without it, but if it disappears the adapter's contract has
		 * changed, and the `executeSync` call site described above must be re-read.
		 */
		expect(range).toBeTruthy();
	});

	it("the pinned worklets version is inside that range", () => {
		/**
		 * If this fails, **native compilation breaks.** There is no JS symptom, so this check is the only
		 * place that reports it.
		 */
		expect(admits(range, pinned["react-native-worklets"])).toBe(true);
	});
});

/**
 * A native module must have exactly one installed copy.
 *
 * `@rowcat/ui-native` takes Reanimated as a peer (its `motion/` folder passes worklet callbacks),
 * and `apps/mobile` provides it. If the two resolve to different installs, the bundle contains two
 * copies of Reanimated, and shared values (`useSharedValue`) live in different runtimes. The
 * symptom is not an error but animations that silently never run.
 *
 * This check caught the problem twice. While the peer range was `^4.5.1`, pnpm installed 4.6.0 on
 * only one side, and only `expo-doctor`'s duplicate check showed it.
 */
describe("install identity", () => {
	const resolveFrom = (importer: string, name: string): string => {
		const require_ = createRequire(`${MOBILE}${importer}/package.json`);
		return realpathSync(require_.resolve(`${name}/package.json`));
	};

	it.each(PAIRED)("%s is the same install in the app and ui-native", (name) => {
		expect(resolveFrom(".", name)).toBe(
			resolveFrom("../../packages/ui-native", name),
		);
	});
});

/**
 * `@expo/ui` must autolink on Android.
 *
 * This is another incident. A store build (versionCode 6, commit `87cf33c8`) listed `@expo/ui` in
 * `expo.autolinking.exclude` without a platform qualifier. The exclusion was justified only for iOS
 * (`SwiftUICore` link failure), but the same line also removed the module on Android. expo-router
 * 57 draws the Android header toolbar with `@expo/ui/jetpack-compose`, and that file calls
 * `requireNativeModule("ExpoUI")` at load time, so the app crashed on first open on a real device.
 *
 * Types, tests and `expo export` all passed, and the development client, built before the
 * exclusion, still ran. The break appeared only when the Play Store build was opened, and logcat
 * was the only clue.
 *
 * The check verifies two things: that expo-router's Android build really requires `@expo/ui`, and
 * that no Android-side exclusion cuts that requirement. If expo-router drops the dependency, the
 * first check fails and this test has no basis left.
 */
describe("@expo/ui's Android autolinking", () => {
	const expoRouterBuild = createRequire(`${MOBILE}package.json`)
		.resolve("expo-router/package.json")
		.replace(/package\.json$/, "build/");
	const toolbar = readFileSync(
		`${expoRouterBuild}toolbar/native.android.js`,
		"utf8",
	);

	it("expo-router's Android toolbar requires @expo/ui at load time", () => {
		expect(toolbar).toContain('require("@expo/ui/jetpack-compose")');
	});

	const autolinking = (
		(manifest.expo ?? {}) as { autolinking?: Record<string, unknown> }
	).autolinking as
		| {
				exclude?: string[];
				android?: { exclude?: string[] };
				ios?: { exclude?: string[] };
		  }
		| undefined;

	it("not in the cross-platform exclusion list", () => {
		/**
		 * This list applies to **all** platforms. Fixing an iOS problem here also drops Android, which is
		 * the incident above. iOS-only exclusions go in `ios.exclude`.
		 */
		expect(autolinking?.exclude ?? []).not.toContain("@expo/ui");
	});

	it("not in the Android exclusion list", () => {
		expect(autolinking?.android?.exclude ?? []).not.toContain("@expo/ui");
	});
});
