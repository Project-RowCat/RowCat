/**
 * Where the iOS runtime WebView may navigate: **only inside its own asset directory.** Pure, so the
 * decision is checked by value; `runtime-host-view.tsx` wires it.
 *
 * ## Why the origin whitelist is `*`
 *
 * `react-native-webview` consults `originWhitelist` **before** `onShouldStartLoadWithRequest`, and a
 * URL that fails the whitelist is not rejected — it is handed to `Linking.openURL`. With
 * `["file://*"]`, escaped code navigating to `https://…?data` or `rowcat://…` would have opened
 * Safari with data of its choosing, or deep-linked into this app's own routes, and our callback
 * would never have seen the URL. So the whitelist lets every URL through to the one decision below,
 * which rejects anything outside the directory whatever its scheme. Nothing reaches `Linking`.
 *
 * Exact matching of the single document is not used: the first load's URL may not match the string
 * built from the bundle path character for character (percent-encoding, symlink resolution). The
 * scope is still one directory holding two committed files.
 */

/** Every URL reaches `runtimeHostNavigationAllowed`; none is handed to the OS. */
export const RUNTIME_HOST_ORIGIN_WHITELIST: string[] = ["*"];

export function runtimeHostNavigationAllowed(
	url: string,
	readAccessUrl: string | null,
): boolean {
	if (readAccessUrl === null || readAccessUrl.length === 0) return false;
	/** A directory scope must end at a separator, or `…/runtime` would admit `…/runtime-other/`. */
	const scope = readAccessUrl.endsWith("/")
		? readAccessUrl
		: `${readAccessUrl}/`;
	if (!url.startsWith(scope)) return false;
	/** No climbing out of the directory through the path. */
	const rest = url.slice(scope.length).split(/[?#]/, 1)[0] ?? "";
	return !/(^|\/)\.\.(\/|$)|%2e%2e/i.test(rest);
}
