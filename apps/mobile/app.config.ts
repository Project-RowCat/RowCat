import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ExpoConfig } from "expo/config";

/** Folder of this config file: Expo evaluates it as CJS (`__dirname` exists) while tests run it through a module runner; both give the same value, falling back to the current folder. */
const PROJECT_ROOT = typeof __dirname === "string" ? __dirname : process.cwd();

/**
 * An EAS build must name the backend it targets, and that name must not be a placeholder. The app
 * has no default API origin (`src/lib/env.ts`, `@rowcat/sdk`): the production origin used to be the
 * default and was one operator's address, which would make a fork's binary a client of someone
 * else's production server.
 *
 * ```text
 * every profile  EXPO_PUBLIC_API_ORIGIN required; stops on an example.com-style placeholder
 *                EXPO_PUBLIC_WEB_ORIGIN may be empty but stops on a placeholder
 * testflight     stops if it equals the API origin of eas.json's production profile
 *                (and stops if that baseline is absent, since it cannot be judged)
 * ```
 *
 * The public `eas.json` holds only placeholders, so EAS builds do not stand from this repository
 * as-is; a fork fills them in. TestFlight's rule exists so pre-release builds leave no side effects
 * on production member data (`src/lib/build-profile.ts` header).
 *
 * Active on EAS builds only; `expo start`, `prebuild` and tests never reach it.
 *
 * The same rule exists once more in `src/lib/build-profile.ts` as a second implementation, not a
 * copy. This file imports no workspace package, only Node built-ins (`fs`, `path` to read the
 * certificate and `eas.json`), so Expo's config evaluation is not tied to workspace package
 * resolution (`app-identity.test.ts` keeps the bundle id literal for the same reason).
 * `build-profile.test.ts` runs the same matrix against both to confirm they agree.
 */
const PLACEHOLDER_DOMAINS = ["example.com", "example.net", "example.org"];
const PLACEHOLDER_TLDS = ["example", "invalid"];

/** Whether the value is an unfilled placeholder (RFC 2606); an unparsable value is not one. */
const isPlaceholderOrigin = (value: string): boolean => {
	let host: string;
	try {
		host = new URL(value).hostname.toLowerCase();
	} catch {
		return false;
	}
	return (
		PLACEHOLDER_DOMAINS.some(
			(domain) => host === domain || host.endsWith(`.${domain}`),
		) || PLACEHOLDER_TLDS.some((tld) => host.endsWith(`.${tld}`))
	);
};

/** Compares ignoring trailing slash and case; unparsable values are never equal. */
const sameOrigin = (left: string, right: string): boolean => {
	try {
		return new URL(left).origin === new URL(right).origin;
	} catch {
		return false;
	}
};

/** Baseline for the TestFlight rule: the committed production profile's API origin; empty if unreadable. */
function committedProductionApiOrigin(): string {
	try {
		const easJson = JSON.parse(
			readFileSync(join(PROJECT_ROOT, "eas.json"), "utf8"),
		) as {
			build?: Record<string, { env?: Record<string, string> } | undefined>;
		};
		return easJson.build?.production?.env?.EXPO_PUBLIC_API_ORIGIN?.trim() ?? "";
	} catch {
		return "";
	}
}

const easBuildProfile = process.env.EAS_BUILD_PROFILE?.trim();
const easApiOrigin = process.env.EXPO_PUBLIC_API_ORIGIN?.trim() ?? "";
const easWebOrigin = process.env.EXPO_PUBLIC_WEB_ORIGIN?.trim() ?? "";

if (process.env.EAS_BUILD === "true" && easBuildProfile) {
	if (!easApiOrigin)
		throw new Error(
			`EAS profile "${easBuildProfile}" has no EXPO_PUBLIC_API_ORIGIN — ` +
				"this app has no default API origin. Put the origin of the deployment this build talks to " +
				"in that profile's env in eas.json.",
		);
	if (isPlaceholderOrigin(easApiOrigin))
		throw new Error(
			`EXPO_PUBLIC_API_ORIGIN (${easApiOrigin}) in EAS profile "${easBuildProfile}" is a placeholder — ` +
				"the public repository's eas.json holds only example.com-family placeholders. " +
				"Replace it with this deployment's real API origin.",
		);
	if (easWebOrigin && isPlaceholderOrigin(easWebOrigin))
		throw new Error(
			`EXPO_PUBLIC_WEB_ORIGIN (${easWebOrigin}) in EAS profile "${easBuildProfile}" is a placeholder — ` +
				"the account deletion guide, guardian consent and password reset links lead nowhere. " +
				"Replace it with this deployment's real web origin or leave it empty (empty means the links aren't drawn).",
		);
	if (easBuildProfile === "testflight") {
		const production = committedProductionApiOrigin();
		if (!production)
			throw new Error(
				`can't decide that EAS profile "${easBuildProfile}" doesn't point at the production API — ` +
					"the production profile in eas.json has no EXPO_PUBLIC_API_ORIGIN. " +
					"Write that value in eas.json (kept as an EAS server secret, this check can't see it).",
			);
		if (sameOrigin(easApiOrigin, production))
			throw new Error(
				`EAS profile "${easBuildProfile}" points at the production backend (EXPO_PUBLIC_API_ORIGIN) — ` +
					"TestFlight is a pre-release build, so sign-ups, deletions and publishes pressed in it land on real member " +
					"data. Use the origin of a non-production deployment (staging).",
			);
	}
}

/**
 * EAS account and project, for a fork to fill; empty in the public repository.
 *
 * `projectId` is an opaque EAS reference under which credentials, build history, version counters
 * and push credentials live. This repository uses a dynamic config (`app.config.ts`), so `eas init`
 * cannot write it; a fork writes the account name and project id here by hand.
 *
 * Not a secret (login decides account access), but left empty because it would point at one
 * operator's project: a fork carrying someone else's project id is blocked on permissions or,
 * worse, receives tokens under that project's push credentials.
 *
 * Empty, EAS builds stop; local `expo start`, `prebuild` and tests run without it (only push
 * registration quietly does not stand: `src/lib/push/native.ts` returns `null` without an id).
 *
 * The condition has one more term than the origin rule (`EAS_BUILD`): a build runner actually
 * exists (`EAS_BUILD_RUNNER`: cloud `eas-build` or local `local-build-plugin`). The origin rule is
 * a pure judgement that tests drive with only `EAS_BUILD` set, and the matrix needs the config to
 * evaluate fully to confirm a pass; tying this axis to `EAS_BUILD` alone would turn these two empty
 * values into a stop in every passing cell. A developer's `eas build` already stops without them
 * (EAS CLI demands linking the project); this line is the defence behind that.
 */
const EAS_OWNER = "";
const EAS_PROJECT_ID = "";

if (
	process.env.EAS_BUILD === "true" &&
	process.env.EAS_BUILD_RUNNER?.trim() &&
	(!EAS_OWNER || !EAS_PROJECT_ID)
)
	throw new Error(
		"the EAS account and project are empty (EAS_OWNER · EAS_PROJECT_ID in app.config.ts) — " +
			"this repository points at no operator's EAS project. " +
			"Create a project with `eas init` and write its account name and project id here.",
	);

/**
 * Native runtime generation: the only source for whether an OTA update may run on this binary.
 *
 * It is neither the JS version nor the app version (`version`); it names which generation of the
 * native contract is baked into the binary (native modules, config plugins, Info.plist, manifest,
 * the runtime WebView harness and QuickJS WASM), and only OTA targeting the same generation runs
 * here (expo-updates filters by runtime).
 *
 * ```text
 * app version         2.0.0              read by the store; a person raises it at submission
 * build number        raised by EAS
 * runtime generation  rowcat-native-N    OTA compatibility; rises only when native changes
 * ```
 *
 * Raise it when the native fingerprint changes. The fingerprint (`@expo/fingerprint`) is recorded
 * per generation in `native-runtime.lock.json`, and the publish tool and `pnpm check` verify the
 * current fingerprint matches this generation's record (`scripts/ota/runtime.ts`); a mismatch stops
 * publishing. If a binary with changed native code shared a generation name with an old binary, JS
 * expecting new native code would reach the old binary. Generation numbers are never reused (the
 * record refuses it).
 *
 * This literal is all this file holds; the publish tool, registration, selection and tests read the
 * value from the evaluated config, so there is no copy.
 */
const RUNTIME_VERSION = "rowcat-native-9";

/**
 * OTA channel: which update stream this binary receives. The build profile decides it
 * (`EAS_BUILD_PROFILE`); app code, server and user do not. Each channel has its own signing key
 * whose certificate is baked into the binary, so the request header's channel is routing, not
 * authority: a TestFlight binary impersonating production would get a manifest that fails
 * verification against its own certificate and is dropped.
 *
 * ```text
 * development   no OTA (Metro serves the bundle)
 * preview       rowcat-preview-<n>      internal QA
 * testflight    rowcat-testflight-<n>   staging API, pre-release
 * production    rowcat-production-<n>   store release
 * outside EAS   enabled only via ROWCAT_OTA_CHANNEL, to verify a release build locally and when
 *               the publish tool evaluates that channel's config
 * ```
 *
 * The number is the key-rotation axis: commit the new key's certificate and change the value here,
 * and binaries built afterwards trust the new key (`docs/ota/OPERATIONS.md`, signing trust
 * rotation).
 *
 * The public repository ships no certificates (only `certs/README.md`). The key ids in the table
 * are name placeholders; a fork makes its own with `pnpm mobile:update keys:generate <channel>` and
 * commits that certificate, since a binary with someone else's certificate runs only code that
 * operator signed.
 *
 * Without a certificate the channel's build stops. There is no way to enable OTA unsigned (it is
 * remote code execution) and no quiet way to disable it: a binary shipped to the store without a
 * certificate never receives OTA until the next store release. To disable deliberately, state
 * `ROWCAT_OTA=off`.
 */
const OTA_CHANNELS = ["preview", "testflight", "production"] as const;
type OtaChannel = (typeof OTA_CHANNELS)[number];

const OTA_SIGNING_KEY_ID: Record<OtaChannel, string> = {
	preview: "rowcat-preview-1",
	testflight: "rowcat-testflight-1",
	production: "rowcat-production-1",
};

const isOtaChannel = (value: string): value is OtaChannel =>
	(OTA_CHANNELS as readonly string[]).includes(value);

function resolveOtaChannel(): OtaChannel | null {
	if (process.env.ROWCAT_OTA?.trim() === "off") return null;
	const explicit = process.env.ROWCAT_OTA_CHANNEL?.trim() || undefined;
	if (process.env.EAS_BUILD === "true" && easBuildProfile) {
		if (explicit && explicit !== easBuildProfile)
			throw new Error(
				`ROWCAT_OTA_CHANNEL (${explicit}) differs from the EAS profile (${easBuildProfile}) — ` +
					"a binary's channel is decided by the profile that built it.",
			);
		return isOtaChannel(easBuildProfile) ? easBuildProfile : null;
	}
	if (!explicit) return null;
	if (!isOtaChannel(explicit))
		throw new Error(
			`ROWCAT_OTA_CHANNEL is one of ${OTA_CHANNELS.join(" · ")} (got: ${explicit}).`,
		);
	return explicit;
}

const otaChannel = resolveOtaChannel();

function otaUpdatesConfig(channel: OtaChannel | null): ExpoConfig["updates"] {
	if (!channel) return { enabled: false };
	const keyId = OTA_SIGNING_KEY_ID[channel];
	const certificate = `./certs/${keyId}.pem`;
	if (!existsSync(join(PROJECT_ROOT, certificate)))
		throw new Error(
			`OTA channel "${channel}" has no signing certificate (${certificate}) — ` +
				`OTA is not turned on without signing. Create one with "pnpm mobile:update keys:generate ${channel}" ` +
				"and commit the certificate (the private key stays outside the repository · a CI secret). " +
				"To turn OTA off on purpose for this build, set ROWCAT_OTA=off.",
		);
	/**
	 * The update URL's origin is this binary's API origin and must equal the bundle's API origin; the
	 * publish tool and registration enforce that (`scripts/ota/environment.ts`). The path prefix
	 * (`/v2`) belongs to the contract, so it is a literal here, and `ota-config.test.ts` compares it
	 * with the SDK's `apiBaseUrl`.
	 *
	 * Without an origin it stops: there is no default to guess, and an OTA-enabled binary that cannot
	 * ask anywhere gets no updates until the next store release.
	 */
	if (!easApiOrigin)
		throw new Error(
			`OTA channel "${channel}" is on but EXPO_PUBLIC_API_ORIGIN is missing — ` +
				"there is no address to ask for updates. Write that channel deployment's API origin.",
		);
	const origin = easApiOrigin.replace(/\/+$/, "");
	return {
		enabled: true,
		url: `${origin}/v2/mobile/updates/manifest`,
		/**
		 * Asks once per cold start and does not wait (`fallbackToCacheTimeout: 0`). The first screen
		 * always opens with the bundle already held and a new update downloads in the background and
		 * applies on the next cold start, so the app never relaunches during generation, runtime
		 * playback, draft autosave or sign-in. The app's JS never calls `reloadAsync()`
		 * (`lib/updates-boundaries.test.ts`).
		 */
		checkAutomatically: "ON_LOAD",
		fallbackToCacheTimeout: 0,
		/**
		 * No differential patches: this server never produces `226 IM Used`. Left on, every asset request
		 * would carry `A-IM` and the base update id, leaving an install's update history in CDN logs and
		 * inviting a half-implemented patch path.
		 */
		enableBsdiffPatchSupport: false,
		codeSigningCertificate: certificate,
		codeSigningMetadata: { keyid: keyId, alg: "rsa-v1_5-sha256" },
		requestHeaders: { "rowcat-update-channel": channel },
	};
}

/**
 * Expo app config: declares only what is needed now.
 *
 * No permissions or capabilities (camera, photos, notifications, background, IAP, associated
 * domains) are declared ahead of a feature that needs them: store review would ask why and have no
 * answer, and users would read the app as already doing that. Permissions arrive with the slice
 * that uses them.
 *
 * Store app identifiers are not chosen here. The iOS bundle id and Android package name come from
 * `@rowcat/domain`'s `APP_BUNDLE_ID` (the server reads it as the audience of Apple native sign-in
 * tokens); a different value here would be a second store app whose Apple sign-in fails server
 * verification. `src/lib/app-identity.test.ts` guards that these literals do not diverge; the
 * config file imports no workspace package, so Expo's config evaluation is not tied to that
 * resolution and a check does the linking.
 *
 * A fork changes this file and `packages/domain/src/app.ts`: the bundle id, scheme and name
 * literals, the EAS account and project above, and the OTA channel key-id table. These are baked
 * into the binary and tied to store registration, so exposing them as knobs gains nothing and makes
 * one more wrong-valued deployment representable.
 *
 * The deep-link `scheme` is the same axis: it is the auth callback address and material for the
 * server's trusted origins (`APP_SCHEME` -> `apps/api/src/auth/trusted-origins.ts`). A different
 * value loses OAuth's return path and makes native requests 403, with only "login failed" as the
 * symptom; the same check guards it.
 *
 * No build number here: neither `ios.buildNumber` nor `android.versionCode`. EAS's server is the
 * source (`appVersionSource: "remote"`), and a copy here would leave unclear who picks the next
 * number, so two people would submit the same one. The human-readable `version` does belong here.
 */
const config: ExpoConfig = {
	name: "RowCat",
	slug: "rowcat",
	scheme: "rowcat",
	/**
	 * EAS account and project, which decide the account a build goes out under. Values live in
	 * `EAS_OWNER` and `EAS_PROJECT_ID` above; when empty the field is omitted (an empty string would
	 * be read by EAS CLI as a project id).
	 *
	 * After filling them, never create a second project: with the same bundle id, a second project
	 * splits the build-number lineage (`appVersionSource: "remote"`) and the two collide in App Store
	 * Connect on a number already used, the same axis as keeping the bundle id unsplit.
	 */
	...(EAS_OWNER ? { owner: EAS_OWNER } : {}),
	...(EAS_PROJECT_ID ? { extra: { eas: { projectId: EAS_PROJECT_ID } } } : {}),
	/**
	 * Human-readable version, which is what this rewrite is called. The last store release is `1.0.2`
	 * and the store requires a value above any approved one; `2.0.0` rather than `1.0.3` is a product
	 * decision (a different app shipping under the legacy bundle id), not a way to clear that floor,
	 * and code cannot guess it.
	 *
	 * It is raised at store submission, not release (`CLAUDE.md`, Versioning), and
	 * `ops_app_version_floor` compares this format (`MAJOR.MINOR.PATCH`; prerelease notation is
	 * avoided for the reason stated there). EAS raises the build number separately.
	 */
	version: "2.0.0",
	runtimeVersion: RUNTIME_VERSION,
	updates: otaUpdatesConfig(otaChannel),
	/**
	 * Home-screen icon. Never put it in `ios/` or `android/`: those are gitignored prebuild output and
	 * files there are wiped by the next `prebuild`. The source is this config and `assets/`, and the
	 * generator (`@expo/prebuild-config`) stamps iOS's `AppIcon.appiconset` and Android's `mipmap-*`
	 * from it.
	 *
	 * 1024x1024 opaque PNG: iOS allows no alpha (App Store Connect rejects the upload) and the system
	 * rounds the corners, so none are applied here.
	 */
	icon: "./assets/icon.png",
	orientation: "portrait",
	userInterfaceStyle: "automatic",
	ios: {
		bundleIdentifier: "com.projectrowcat.app",
		supportsTablet: false,
		/**
		 * Export-compliance declaration only, not a permission. `ITSAppUsesNonExemptEncryption: false`
		 * pre-answers the question the App Store asks on every submission; without it a person retypes
		 * the same answer per build, and answering differently once sends that build to export-compliance
		 * review.
		 *
		 * The "do not pre-declare permissions" rule in the header stands: it blocks
		 * `NS...UsageDescription` and `src/lib/native-config.test.ts` locks that none exist. That test
		 * also locks this declaration's presence, since with an absence check alone the shortest way to
		 * turn it green would be deleting this line.
		 */
		infoPlist: {
			ITSAppUsesNonExemptEncryption: false,
		},
	},
	android: {
		package: "com.projectrowcat.app",
		/**
		 * Android cannot use the same artwork. Adaptive icons are cropped by the launcher into its own
		 * shape, so on the 108dp canvas only the central 72dp shows and the parallax-safe zone is a
		 * circle of diameter 66dp. Passing the original would clip the `RowCat` wordmark at the sides,
		 * and clipped letters are worse than none.
		 *
		 * The foreground is therefore the cat R mark alone; including the wordmark would shrink the mark
		 * to about 40%, and Android already draws the app name under the icon.
		 *
		 * `assets/adaptive-icon.png` derives from `icon.png` and can be rebuilt by hand:
		 *
		 * ```text
		 * mark bounding box  left 113, top 123, 686x603     (original 1024 coordinates)
		 * mark inscribed circle  diameter 878.3             fit this, not the bounding box
		 * safe zone          1024 x 66/108 = 626
		 * scale              626 / 878.3 = 0.7127 -> 488x429   centred (floored) on a 1024 canvas
		 * ```
		 *
		 * The foreground is an opaque purple filling the canvas; the background is not punched
		 * transparent around the mark, since chroma keying leaves fringes on antialiased edges and
		 * `backgroundColor` is the same value anyway, so the mask cuts a uniform colour and there is no
		 * seam even when the launcher shifts the foreground.
		 *
		 * That purple (#644ebd) was measured from the original background, not chosen. Design tokens are
		 * not used because this is the artwork's colour, not product UI colour; following a token change
		 * in only half the icon would create a seam.
		 */
		adaptiveIcon: {
			foregroundImage: "./assets/adaptive-icon.png",
			backgroundColor: "#644ebd",
		},
		/**
		 * Removes two permissions the template adds but this app does not use. Both prompt Play review
		 * for a justification and show in the store listing; the app has no recording or
		 * draw-over-other-apps feature. `lib/native-config.test.ts` counts the permission set exactly.
		 */
		blockedPermissions: [
			"android.permission.RECORD_AUDIO",
			"android.permission.SYSTEM_ALERT_WINDOW",
		],
	},
	plugins: [
		"expo-router",
		"expo-sqlite",
		"expo-secure-store",
		"expo-status-bar",
		"expo-web-browser",
		/**
		 * PortOne identity verification, where adult eligibility checks actually happen.
		 *
		 * The plugin attaches no native code. It only puts a list of external apps that may be queried
		 * into iOS `LSApplicationQueriesSchemes` and Android `<queries>`. Without it `canOpenURL` always
		 * answers false, so at the moment of handing off to PASS or a carrier auth app, the app does not
		 * open and bounces to the store (`marketIfFail` in `@portone/react-native-sdk`).
		 *
		 * `<queries>` is not a permission. The plugin adds no runtime permission (no camera, contacts,
		 * call log, SMS or location), and `src/lib/native-config.test.ts` checks that absence on the
		 * generated config, so it breaks first if the plugin later adds anything.
		 *
		 * Do not retype the list by hand: the official plugin tracks the schemes each channel needs, and
		 * a chosen subset quietly falls short the day a verification authority calls one more payment
		 * app, with the symptom "only that carrier's users cannot verify".
		 *
		 * Needs a native rebuild (it touches the build pipeline). No native module is added;
		 * `react-native-webview` drawing one window is the whole SDK.
		 */
		"@portone/react-native-sdk/plugin",
		/**
		 * Sign in with Apple, the sheet the login screen's button actually opens.
		 *
		 * The plugin adds one thing: the `com.apple.developer.applesignin` iOS entitlement. No runtime
		 * permission or usage-description string is added, and nothing on Android, where this method
		 * remains a browser round trip (`src/lib/apple-auth.ts` decides that fork with
		 * `isAvailableAsync()`).
		 *
		 * Needs `prebuild`: the entitlement lives in both the Xcode project and the provisioning profile,
		 * and shipping without it leaves the sheet from appearing, a failure that does not reproduce in
		 * the simulator. Like `react-native-svg` and PortOne it touches the build pipeline, which is why
		 * this is written down.
		 *
		 * Developer-console setup exists separately: the app's App ID must have the Sign in with Apple
		 * capability, and the Services ID the server uses must have that App ID as its primary app. Those
		 * are console values, so they cannot be checked here.
		 */
		"expo-apple-authentication",
		/**
		 * Native push, where the notification delivery plane actually opens.
		 *
		 * The plugin does three things: adds the remote-notification capability on iOS, wires the
		 * notification icon and default channel on Android, and links both platforms' native modules.
		 * Needs `prebuild`, touching the build pipeline like `react-native-svg`, PortOne and
		 * `expo-apple-authentication`.
		 *
		 * This adds one runtime permission. Until now the app required no `NS...UsageDescription` or
		 * Android runtime permission, which `src/lib/native-config.test.ts` locked. Notification
		 * permission (iOS UserNotifications, Android 13+ `POST_NOTIFICATIONS`) is the first exception,
		 * and the app never asks for it itself: the system prompt appears only when the user explicitly
		 * turns on `Push notifications` in settings (`src/features/push/` header).
		 *
		 * No sound file is bundled: the repository has no intended sound asset or policy, the default
		 * sound suffices, and adding an asset would be a brand decision.
		 *
		 * Credentials are EAS values, not code. iOS needs an APNs key and Android FCM server credentials
		 * registered on the EAS project; without them tokens are issued but delivery fails with a
		 * provider error rather than `DeviceNotRegistered`. They cannot be checked here.
		 */
		"expo-notifications",
		"expo-font"
	],
	experiments: {
		typedRoutes: false,
	},
};

export default config;
