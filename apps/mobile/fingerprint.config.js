/**
 * Scope of the native fingerprint: counts only the native contract the JS depends on. The one
 * question it answers is whether two binaries may run the same OTA bundle, so anything unrelated to
 * that is excluded.
 *
 * Counted: autolinked native modules (version and source), config plugins, the native parts of the
 * app config, and local modules (`modules/rowcat-runtime-webview` holds the harness HTML and the
 * QuickJS WASM). Excluded: version, build number, name and icon (store-facing, not JS
 * compatibility); `runtimeVersion` (the generation name itself, so counting it is circular); the
 * whole `updates` block (per-channel update URL, certificate and channel header); gitignored
 * prebuild output (`android/`, `ios/`); `eas.json` and `certs/` (where a binary came from, not a JS
 * contract).
 *
 * `updates` matters most: counting it would split the fingerprint per channel from the same source
 * and need one `native-runtime.lock.json` record per channel, yet channels are not a native
 * contract. For the same reason a certificate swap does not raise the generation (the key id
 * answers it).
 *
 * Editing this file changes the fingerprint. Narrowing the scope deserves the same review weight as
 * raising a generation: whatever is dropped here no longer stops a publish on native changes.
 */
module.exports = {
	sourceSkips: [
		"ExpoConfigVersions",
		"ExpoConfigRuntimeVersionIfString",
		"ExpoConfigNames",
		"ExpoConfigAssets",
		"ExpoConfigEASProject",
		"PackageJsonScriptsAll",
		"GitIgnore",
	],
	ignorePaths: [
		"android/**/*",
		"ios/**/*",
		"eas.json",
		"certs/**/*",
		".ota/**/*",
		"dist/**/*",
	],
	fileHookTransform: (source, chunk) => {
		if (source.type !== "contents" || source.id !== "expoConfig") return chunk;
		const config = JSON.parse(String(chunk));
		delete config.updates;
		return JSON.stringify(config);
	},
};
