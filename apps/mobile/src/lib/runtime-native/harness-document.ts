/**
 * The trusted runtime WebView's document: two inline scripts (a prelude, then the bundle) under a
 * Content-Security-Policy. Pure;
 * `scripts/build-runtime-vm-harness.ts` calls it and commits the result as an app asset.
 *
 * ## The realm's network fence is three pieces, and each closes something different
 *
 * QuickJS/WASM is the isolation. What follows only stands if creator code ever escapes it into the
 * WebView's own JavaScript realm, where `fetch`, `XMLHttpRequest`, `WebSocket`, `sendBeacon`,
 * `<img>`, WebRTC and DNS prefetch all exist. On iOS the document is a `file:` URL with no request
 * interception; on Android `shouldInterceptRequest` (403 off the asset origin) sees ordinary
 * subresource loads only — never a WebSocket, a WebRTC ICE/STUN/TURN exchange or a DNS prefetch.
 *
 * ```text
 * Content-Security-Policy   fetch · XHR · WebSocket · EventSource · beacon (connect-src)
 *                           images · styles · fonts · media · frames · workers (default-src 'none')
 *                           form posts · <base> (form-action · base-uri)
 * the prelude               WebRTC. No shipped CSP directive governs ICE/STUN/TURN in Chromium or
 *                           WebKit — `connect-src` does not, and `webrtc` is not implemented — and
 *                           both WebViews expose RTCPeerConnection without a permission prompt. So the
 *                           constructors (`RTC*`, `webkitRTC*`) are deleted from the global object by
 *                           a script that runs before the bundle; the harness uses none of them.
 * x-dns-prefetch-control    DNS prefetch (`<link rel=dns-prefetch>`, anchors). CSP does not reliably
 *                           cover it either; turned off by the document, it cannot be turned back on.
 * ```
 *
 * What the prelude cannot reach is a second realm: a same-origin child frame (an initial
 * `about:blank`, which `default-src 'none'` does not refuse) carries its own constructors. The fence
 * narrows the escaped realm's reach; it is not a second isolation, and the comments elsewhere must
 * not say it is. Nor is the list above proven complete: whether `<link rel=preconnect>` (DNS, TCP
 * and TLS to a named host) is refused by this policy in Android WebView and WKWebView has not been
 * checked on a device.
 *
 * ## What the harness actually loads, and nothing more
 *
 * ```text
 * script-src   'unsafe-inline'      the prelude and the bundle are inline <script>s; no script file
 *              'wasm-unsafe-eval'   compiling QuickJS (WebKit 16+, Chromium 97+); not 'unsafe-eval'
 * connect-src  'self'               Android: fetch of runtime/quickjs-ng.wasm from the asset origin
 *              file:                iOS: the same fetch from the bundle directory (file: has no
 *                                   reliable 'self'; WKWebView's read access already narrows it to
 *                                   that one directory, and a file: URL cannot leave the device)
 * everything else                   'none' — no images, styles, frames, workers, forms, base
 * ```
 *
 * `form-action` and `base-uri` do not fall back to `default-src`, so they are named. Embedder
 * scripts (react-native-webview's injected bridge and `injectJavaScript`) are not subject to a page
 * policy, so the iOS bridge is unaffected. The policy rides in a `<meta>` before the scripts, the
 * only place a file document can carry one.
 *
 * Changing any of these strings changes the generated harness, which is a native asset: it needs a
 * new runtime generation and binary like any other harness change.
 */
export const RUNTIME_HARNESS_CSP = [
	"default-src 'none'",
	"script-src 'unsafe-inline' 'wasm-unsafe-eval'",
	"connect-src 'self' file:",
	"base-uri 'none'",
	"form-action 'none'",
].join("; ");

/**
 * Runs before the bundle, in its own script, so nothing the bundle evaluates sees a WebRTC
 * constructor on this realm's global. Code that escapes into the realm can still reach a same-origin
 * child frame's own constructors (see the header) — this narrows reach, it does not close it. It matches names by prefix, on the global object and its
 * prototype chain, so a constructor a later WebView adds (`RTCEncodedVideoFrame`, …) goes with the
 * rest. A name that survives deletion (inherited, or not configurable) is shadowed by a locked
 * `undefined`, so escaped code can neither read it nor put it back.
 */
export const RUNTIME_HARNESS_PRELUDE =
	"(function(){var g=globalThis,o=g,s={};for(;o;o=Object.getPrototypeOf(o))Object.getOwnPropertyNames(o).forEach(function(n){if(/^(webkit)?RTC/.test(n))s[n]=1});Object.keys(s).forEach(function(n){try{delete g[n]}catch(e){}if(n in g)try{Object.defineProperty(g,n,{value:void 0,writable:false,configurable:false})}catch(e){}})})();";

/** One HTML page around the bundled harness script. `</script` inside the bundle cannot close the tag. */
export function runtimeHarnessDocument(script: string): string {
	return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${RUNTIME_HARNESS_CSP}"><meta http-equiv="x-dns-prefetch-control" content="off"><meta name="viewport" content="width=device-width"></head><body><script>${RUNTIME_HARNESS_PRELUDE}</script><script>${script.replace(/<\/script/gi, "<\\/script")}</script></body></html>`;
}
