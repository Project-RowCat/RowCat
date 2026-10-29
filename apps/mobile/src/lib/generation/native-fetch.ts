import { fetch as expoFetch } from "expo/fetch";
import type { ByoFetch } from "./byo.ts";

/**
 * The single boundary for native transport — the only file in this app that imports `expo/fetch`.
 *
 * ## Why not the global `fetch`
 *
 * React Native's default `fetch` sits on an XHR polyfill and has no `response.body`. Streaming
 * built on it buffers the whole response and emits it at once, which defeats the point of this
 * slice (rendering tokens as they arrive). That failure raises no error: the screen freezes for
 * several seconds, then shows a finished paragraph in one go.
 *
 * Expo SDK 57's winter runtime replaces the global `fetch` with this implementation by default, but
 * `EXPO_PUBLIC_USE_RN_FETCH` switches that replacement off. A deployment with that flag on would
 * silently lose streaming if it called the global, so this file imports by name: which
 * implementation runs must be in the code, not in configuration.
 *
 * ## No native rebuild
 *
 * `expo/fetch` is already pulled in by the `expo` package (`ExpoFetch` lives in core). That is why
 * this slice adds no dependency or config plugin, unlike `react-native-svg` or `expo-image-picker`.
 *
 * ## Cookies are not sent
 *
 * `expo/fetch` defaults `credentials` to `include`, which turns on the OS cookie jar. Requests from
 * here go to a **third-party provider**, so that switch must be off. Left on, our session cookie
 * and the provider domain's cookies could travel together, which the user did not agree to in this
 * feature (`lib/auth-fetch.ts` made the same call for the same reason).
 */
export const nativeStreamingFetch: ByoFetch = async (url, init) => {
	const response = await expoFetch(url, {
		method: init.method,
		headers: init.headers,
		...(init.body === undefined ? {} : { body: init.body }),
		signal: init.signal,
		/** See the header: this device's cookies are not attached to a third-party request. */
		credentials: "omit",
	});
	return {
		ok: response.ok,
		status: response.status,
		headers: response.headers,
		/**
		 * Pass `body` through unwrapped. Wrapping it would stop cancellation from reaching the upstream
		 * socket, and the model would keep generating — **those tokens are billed to the user's provider
		 * account.**
		 */
		body: response.body,
	};
};
