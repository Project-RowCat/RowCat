import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import config from "../../app.config.ts";

/**
 * Boundary of the native config: what the identity-verification plugin brings in and what it does
 * not.
 *
 * The official PortOne config plugin adds no native code. It does two things: it adds to iOS
 * `LSApplicationQueriesSchemes` and Android `<queries>` the list of external apps the app may ask
 * about. Without that list `canOpenURL` always returns false, so when the flow must hand off to the
 * PASS or carrier auth app, the app does not open and falls to the store.
 *
 * ## `<queries>` is not a permission
 *
 * The main reason this check exists is that one sentence. Reading the two as the same thing leads
 * to the wrong conclusion that "identity verification requires call log or SMS permission".
 * Conversely, a permission that really was added would go unnoticed in review. So the check reads
 * the installed plugin's actual code, and also the generated native config when it exists.
 *
 * When the SDK version rises, this check fails first. That moment is where to ask again what was
 * added.
 */

const SDK = fileURLToPath(
	new URL("../../node_modules/@portone/react-native-sdk/", import.meta.url),
);
const NATIVE = fileURLToPath(new URL("../../", import.meta.url));

const read = (path: string) => readFileSync(`${SDK}${path}`, "utf8");

describe("installed plugins", () => {
	it("attached to the config", () => {
		/**
		 * Without it the verification window opens, but on handoff to the PASS app the app falls to the
		 * store. That failure does not reproduce in the simulator, because those apps are not installed
		 * there.
		 */
		expect(config.plugins).toContain("@portone/react-native-sdk/plugin");
	});

	/**
	 * The store identity and deep-link scheme must stay as they are. If this integration changed the
	 * bundle id or scheme, it would be a second store app rather than a config mistake, and its
	 * receipts would fail our server's bundle verification (`app-identity.test.ts` checks equality
	 * with the single source).
	 */
	it("didn't touch the store identity or the scheme", () => {
		expect(config.ios?.bundleIdentifier).toBe("com.projectrowcat.app");
		expect(config.android?.package).toBe("com.projectrowcat.app");
		expect(config.scheme).toBe("rowcat");
		/**
		 * The rule that permissions are not declared in config still holds, but it is not the **absence**
		 * of `infoPlist`.
		 *
		 * At one time this spot checked that `infoPlist` was entirely absent, which then meant the same
		 * thing. It no longer does: the export-compliance declaration (`ITSAppUsesNonExemptEncryption`)
		 * lives there. That value is neither a capability nor an access permission. It is a declaration
		 * that answers a question App Store submission asks, so without it every build would need someone
		 * to re-enter the same answer.
		 *
		 * So the check looks for what must not be present, not for absence. Permissions always appear as
		 * `NS…UsageDescription` (that text is the request reason shown to the user), and the rule is
		 * effectively that none of that shape exists. Pinning absence would make the check get edited
		 * toward "delete the rule" the next time a legitimate declaration is needed.
		 */
		const infoPlist = config.ios?.infoPlist ?? {};
		/**
		 * The export-compliance declaration is actually present. The positive assertion is the point:
		 * with only an absence check, the shortest way to turn this green is deleting that declaration,
		 * and the deletion would look like an ordinary diff in review. A build without it makes someone
		 * re-answer the same question on every submission, and one differing answer sends that build to
		 * export-compliance review.
		 */
		expect(infoPlist.ITSAppUsesNonExemptEncryption).toBe(false);
		/**
		 * Permissions always appear as `NS…UsageDescription`. That text is the request reason shown to
		 * the user, so one shape covers all of them. Enumerating a list would let the next key identity
		 * verification might bring slip through silently.
		 */
		expect(
			Object.keys(infoPlist).filter((key) => key.endsWith("UsageDescription")),
		).toEqual([]);
		/**
		 * Apart from pinning the shape, names that identity verification might bring are blocked by name
		 * too. The filter above already covers them, but the names being written down lets the next
		 * person read what must not appear.
		 */
		for (const forbidden of [
			"NSContactsUsageDescription",
			"NSLocationWhenInUseUsageDescription",
			"NSLocationAlwaysAndWhenInUseUsageDescription",
			"NSCalendarsUsageDescription",
			"NSMotionUsageDescription",
			"NSMicrophoneUsageDescription",
		])
			expect(infoPlist, forbidden).not.toHaveProperty(forbidden);
		/**
		 * ⚠️ Notification permission is added by the plugin during prebuild — it is not in this config
		 * object. Checking that absence here still has value: once we start writing the permission list
		 * by hand, that list must answer "why is this needed" (see header).
		 */
		expect(config.android?.permissions).toBeUndefined();
	});

	/**
	 * The plugin adds no permissions. Verify that from its code: it touches only two surfaces, and it
	 * never calls the APIs that add permissions, rather than scanning the list by eye.
	 */
	it("doesn't call APIs that add permissions", () => {
		const plugin = read("lib/commonjs/plugin.js");
		expect(plugin).toContain("withAndroidManifest");
		expect(plugin).toContain("withInfoPlist");
		for (const forbidden of [
			/uses-permission/,
			/withPermissions/,
			/AndroidConfig\.Permissions/,
			/READ_SMS|READ_CALL_LOG|READ_PHONE_STATE|READ_CONTACTS/,
			/\bCAMERA\b|ACCESS_FINE_LOCATION|ACCESS_COARSE_LOCATION/,
			/NSCameraUsageDescription|NSContactsUsageDescription|NSLocationWhenInUseUsageDescription/,
			/withEntitlementsPlist|withDangerousMod|withXcodeProject/,
		])
			expect(plugin, String(forbidden)).not.toMatch(forbidden);
	});

	/**
	 * iOS has a practical ceiling on query schemes (50). While the official list stays below it, we do
	 * not hand-pick a subset: a hand-picked subset silently falls short the day the verifier calls one
	 * more payment app, and the symptom is "authentication fails only for users of that carrier". This
	 * check breaks first when the ceiling is crossed, and that is when to decide whether to narrow the
	 * list.
	 */
	it("iOS query schemes are under the platform cap", () => {
		const table = read("lib/commonjs/appScheme.js");
		const iosEntries = table.match(/ios:\s*'/g) ?? [];
		expect(iosEntries.length).toBeGreaterThan(20);
		expect(iosEntries.length).toBeLessThanOrEqual(50);
	});
});

/**
 * Generated native config — checked only when present.
 *
 * `apps/mobile/android` and `ios` are prebuild outputs and not in source (`.gitignore`). So this
 * group is a safety net only for people who ran `expo prebuild` locally. The net that always runs
 * is the one above (the installed plugin's code).
 */
const manifest = `${NATIVE}android/app/src/main/AndroidManifest.xml`;

describe.skipIf(!existsSync(manifest))("generated Android manifest", () => {
	const xml = () => readFileSync(manifest, "utf8");

	/**
	 * Permissions are an exact set, not a deny list. As on the iOS side (`NS…UsageDescription`), each
	 * line records the owner that brought that permission in. While this was a deny list,
	 * `RECORD_AUDIO` and `SYSTEM_ALERT_WINDOW` passed through unlisted. Both are permissions store
	 * review asks the reason for, and this repo could not say which plugin added them. When a new
	 * library adds a permission, this test breaks first, and the owner is recorded on that line.
	 *
	 * `RECORD_AUDIO` and `SYSTEM_ALERT_WINDOW` are values the template included, and
	 * `blockedPermissions` in `app.config.ts` removes them. Their absence from this list is the
	 * evidence that the setting took effect.
	 */
	it("the permission set is exactly this and each line has an owner", () => {
		/**
		 * An entry with `tools:node="remove"` is a removal of that permission, not a permission.
		 * `blockedPermissions` expresses it this way. Scraping names alone would read a removed entry as
		 * present.
		 */
		const tags = [...xml().matchAll(/<uses-permission\b[^>]*\/>/g)].map(
			(match) => match[0],
		);
		const permissions = tags
			.filter((tag) => !tag.includes('tools:node="remove"'))
			.map((tag) => /android:name="([^"]+)"/.exec(tag)?.[1] as string)
			.sort();
		const removed = tags
			.filter((tag) => tag.includes('tools:node="remove"'))
			.map((tag) => /android:name="([^"]+)"/.exec(tag)?.[1] as string)
			.sort();
		expect(removed).toEqual([
			"android.permission.RECORD_AUDIO",
			"android.permission.SYSTEM_ALERT_WINDOW",
		]);
		const expected: Record<string, string> = {
			"android.permission.INTERNET": "Expo template — network",
			"android.permission.VIBRATE": "Expo template — haptics",
			"android.permission.READ_EXTERNAL_STORAGE":
				"expo-image-picker (maxSdk 32)",
			"android.permission.WRITE_EXTERNAL_STORAGE":
				"expo-image-picker (maxSdk 32)",
		};
		expect(permissions).toEqual(Object.keys(expected).sort());
	});

	/**
	 * Auto backup does not carry SQLite. `allowBackup="true"` itself is a template value. What makes
	 * it safe is that `expo-secure-store`'s rules file explicitly includes only `sharedpref`, and the
	 * per-member database (`files/SQLite/…`) is in the `file` domain, so it is left out. That property
	 * depends on plugin order: if another plugin claims `fullBackupContent` first, `expo-secure-store`
	 * leaves only a warning line and backs off. The warning gets missed; the test does not.
	 */
	it("the backup rules are expo-secure-store's", () => {
		expect(xml()).toContain(
			'android:fullBackupContent="@xml/secure_store_backup_rules"',
		);
		expect(xml()).toContain(
			'android:dataExtractionRules="@xml/secure_store_data_extraction_rules"',
		);
	});

	/**
	 * `<queries>` actually made it in. Without it `canOpenURL` returns false and the PASS app handoff
	 * falls to the store. The absence is a silent failure, so its presence is checked by value.
	 */
	it("the external app query list went in", () => {
		const packages = [
			...xml().matchAll(/<package android:name="([^"]+)"/g),
		].map((match) => match[1]);
		expect(packages.length).toBeGreaterThan(20);
		/** The three carrier identity-verification (PASS) apps are actually in the list. */
		for (const app of [
			"com.sktelecom.tauth",
			"com.kt.ktauth",
			"com.lguplus.smartotp",
		])
			expect(packages, app).toContain(app);
	});
});

const infoPlist = `${NATIVE}ios/RowCat/Info.plist`;

describe.skipIf(!existsSync(infoPlist))("generated iOS Info.plist", () => {
	const plist = () => readFileSync(infoPlist, "utf8");

	/**
	 * The query schemes are in and below the ceiling. iOS does not accept this array without limit
	 * (practical ceiling 50), so the count is checked by value. Going over silently ignores the tail,
	 * and the symptom is "some auth apps do not open".
	 */
	it("the query schemes went in and are under the cap", () => {
		const block = plist().split("LSApplicationQueriesSchemes")[1] ?? "";
		const array = block.split("</array>")[0] ?? "";
		const entries = [...array.matchAll(/<string>([^<]+)<\/string>/g)];
		expect(entries.length).toBeGreaterThan(20);
		expect(entries.length).toBeLessThanOrEqual(50);
		const schemes = entries.map((match) => match[1]);
		/** The three PASS schemes are actually in the list. */
		for (const scheme of [
			"tauthlink",
			"ktauthexternalcall",
			"upluscorporation",
		])
			expect(schemes, scheme).toContain(scheme);
	});

	/**
	 * The usage-description list is exactly four, and each has an owner.
	 *
	 * The reason this is not written as an absence list (no contacts, location, calendar or motion) is
	 * this check's whole point. An absence list blocks only the names written in advance. If the
	 * identity provider adds one more microphone key in its next version, it passes the absence list,
	 * and the fact surfaces only in store review. So the check inverts the question: is everything
	 * present here from some other slice? The four owners are below, and all four were there before
	 * identity verification.
	 *
	 * ```text
	 * NSCameraUsageDescription        expo-image-picker   avatar photo picker
	 * NSMicrophoneUsageDescription    expo-image-picker   same (the same plugin adds it alongside)
	 * NSPhotoLibraryUsageDescription  expo-image-picker   same
	 * NSFaceIDUsageDescription        expo-secure-store   sync keyring
	 * ```
	 *
	 * That the microphone key is on this list is not a flaw of identity verification. The key came
	 * from the photo picker long ago (the same plugin adds all three), and blaming identity
	 * verification for it would make this check block an unrelated slice while saying nothing when the
	 * list actually grows. A fifth key will break this check first, and that is where its owner gets
	 * recorded.
	 */
	it("there are only four usage description strings and all belong to other slices", () => {
		const keys = [...plist().matchAll(/<key>(NS\w*UsageDescription)<\/key>/g)]
			.map((match) => match[1])
			.sort();
		expect(keys).toEqual([
			"NSCameraUsageDescription",
			"NSFaceIDUsageDescription",
			"NSMicrophoneUsageDescription",
			"NSPhotoLibraryUsageDescription",
		]);
	});

	/**
	 * The owners of those four are really that plugin. The check above says "exactly these four" but
	 * cannot say who added them, so the same key name added by PortOne would still pass. Confirming
	 * ownership in the installed plugins' code fills that gap.
	 */
	it("those four's owners are the photo picker and SecureStore", () => {
		const owned = (pkg: string) =>
			readFileSync(
				fileURLToPath(new URL(`../../node_modules/${pkg}`, import.meta.url)),
				"utf8",
			);
		const picker = owned("expo-image-picker/plugin/build/withImagePicker.js");
		for (const key of [
			"NSCameraUsageDescription",
			"NSMicrophoneUsageDescription",
			"NSPhotoLibraryUsageDescription",
		])
			expect(picker, key).toContain(key);
		expect(
			owned("expo-secure-store/plugin/build/withSecureStore.js"),
		).toContain("NSFaceIDUsageDescription");
	});

	/**
	 * The export-compliance declaration is actually in the generated output. Writing it in config and
	 * having it appear in the generated plist are different facts, and the store reads the latter.
	 * Without this check a stale prebuild could be submitted without the declaration.
	 */
	it("the export compliance declaration is in the generated output", () => {
		expect(plist()).toContain("ITSAppUsesNonExemptEncryption");
	});
});

/**
 * The merged manifest is the final truth.
 *
 * Permissions absent from the source `AndroidManifest.xml` can arrive through library merges, and
 * the store sees the result. Three things are checked here: that identity verification brought in
 * no permissions, that the query list was actually merged, and what the web view library added
 * (only a file provider and the Chromium payment-intent query).
 *
 * `CAMERA` in the list is unrelated to this slice. The avatar photo picker (`expo-image-picker`)
 * brought it in long ago, and the merge report records that.
 */
const merged = `${NATIVE}android/app/build/intermediates/merged_manifest/debug/processDebugMainManifest/AndroidManifest.xml`;

describe.skipIf(!existsSync(merged))("merged Android manifest", () => {
	const xml = () => readFileSync(merged, "utf8");

	it("no sensitive permissions brought by identity verification", () => {
		const permissions = new Set(
			[...xml().matchAll(/android:name="(android\.permission\.[A-Z_]+)"/g)].map(
				(match) => match[1],
			),
		);
		for (const forbidden of [
			"android.permission.READ_SMS",
			"android.permission.RECEIVE_SMS",
			"android.permission.READ_CALL_LOG",
			"android.permission.READ_PHONE_STATE",
			"android.permission.READ_CONTACTS",
			"android.permission.ACCESS_FINE_LOCATION",
			"android.permission.ACCESS_COARSE_LOCATION",
			"android.permission.QUERY_ALL_PACKAGES",
		])
			expect([...permissions], forbidden).not.toContain(forbidden);
	});

	/**
	 * The absence of `QUERY_ALL_PACKAGES` matters most in this list. That permission is the opposite
	 * of `<queries>`: instead of asking by list, it lets the app see every installed app, and Play
	 * reviews it under a separate policy. The official plugin adds only the list.
	 */
	it("the external app query list was merged", () => {
		const packages = [
			...xml().matchAll(/<package android:name="([^"]+)"/g),
		].map((match) => match[1]);
		for (const app of [
			"com.sktelecom.tauth",
			"com.kt.ktauth",
			"com.lguplus.smartotp",
		])
			expect(packages, app).toContain(app);
	});
});
