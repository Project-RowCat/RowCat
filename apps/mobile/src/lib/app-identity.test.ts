import { APP_BUNDLE_ID, APP_SCHEME } from "@rowcat/domain";
import { describe, expect, it } from "vitest";
import config from "../../app.config.ts";

/**
 * The store app identifier must be a single value. `APP_BUNDLE_ID` in `@rowcat/domain` is also the
 * audience the server reads from Apple native sign-in tokens (`appBundleIdentifier`). A different
 * value here would be a second store app whose Apple sign-in fails verification. The config file
 * cannot import the workspace package (Expo evaluates it under its own resolution), so this test
 * ties the two together.
 */
describe("store app identifiers", () => {
	it("the iOS bundle ID equals the domain's single source", () => {
		expect(config.ios?.bundleIdentifier).toBe(APP_BUNDLE_ID);
	});

	it("the Android package name is the same value", () => {
		expect(config.android?.package).toBe(APP_BUNDLE_ID);
	});

	it("declares no permissions at all", () => {
		/**
		 * Declaring permissions before a feature needs them leaves store review with no answer to "why is
		 * this needed", and users read it as the app already doing that. Auth adds none: social sign-in
		 * happens in the system browser or the OS sheet (Apple native sign-in adds a credential, not a
		 * permission), so no camera, contacts, photos, location or notification permission is needed.
		 *
		 * The check is not "no infoPlist": that dictionary holds non-permissions too, such as the
		 * export-compliance answer (`ITSAppUsesNonExemptEncryption`), a declared answer rather than a
		 * capability or access right. Permissions always take the `NS…UsageDescription` form (the text is
		 * the request reason shown to the user), so the check looks only at that form. Checking for the
		 * whole key would start removing a legitimate declaration the day one is needed.
		 */
		const infoPlist = config.ios?.infoPlist ?? {};
		expect(
			Object.keys(infoPlist).filter((key) => key.endsWith("UsageDescription")),
		).toEqual([]);
		expect(config.android?.permissions).toBeUndefined();
	});
});

/**
 * The deep link scheme must match in three places:
 *
 * ```text
 * scheme in app.config.ts                    registers the app with the OS
 * expoClient({ scheme })                     builds the callback deep link and the `expo-origin` header
 * trustedOrigins (`rowcat://`) in apps/api   accepts requests from that origin only
 * ```
 *
 * If one differs, the symptom is only a sign-in failure: the server logs a single `Invalid origin`
 * line and the screen says just "try again". The last two import the constant from
 * `@rowcat/domain`, but the config file cannot, so this test ties them together.
 */
describe("deep link scheme", () => {
	it("the Expo config's scheme equals the domain's single source", () => {
		expect(config.scheme).toBe(APP_SCHEME);
	});

	it("the plugin that opens OAuth's browser session is attached", () => {
		/**
		 * Without it Google sign-in cannot open the sheet, and the failure surfaces at runtime as the
		 * library exception `"expo-web-browser" is not installed as a dependency!`.
		 */
		expect(config.plugins).toContain("expo-web-browser");
	});
});
