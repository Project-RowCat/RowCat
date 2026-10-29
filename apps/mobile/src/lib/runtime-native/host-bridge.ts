import { Platform } from "react-native";
import { rowcatRuntimeNativeModule } from "../../../modules/rowcat-runtime-webview/index.ts";
import { RUNTIME_ASSET_DIR, RUNTIME_HARNESS_FILE } from "./runtime-assets.ts";
import {
	createNativeRuntimeTransport,
	type NativeRuntimeBridgeKind,
	type NativeRuntimeTransport,
} from "./transport.ts";

/**
 * Whether this device can stand up a trusted runtime. **There is one answer.**
 *
 * ```text
 * android   native module + WebMessagePort                android-webmessage
 * ios       bundle path from the native module + WKWebView  ios-webview
 * other, or no module                                       unavailable
 * ```
 *
 * ## No silent fallback
 *
 * If `WebMessagePort` cannot be set up on Android, this does **not** fall back to
 * `injectJavaScript`. That fallback would quietly turn the production path into the slowest bridge
 * (a measured round trip of 68ms on the emulator), and worse, it would make it impossible to say
 * which path a measurement belongs to, so the answer to the 32ms gate would become meaningless.
 * When it cannot be set up the result is `unavailable`, and the screen draws that fact.
 *
 * ## The one place that reads `Platform.OS`
 *
 * The transport layer, session and renderer are all platform-agnostic. What differs is how the
 * document is loaded and how strings are carried, and the view owns those two things.
 */

export interface NativeRuntimeHostDescriptor {
	bridge: NativeRuntimeBridgeKind;
	/** The harness document's address. `null` when `unavailable`. */
	documentUrl: string | null;
	/** The read-access scope given to WKWebView. `null` on Android. */
	readAccessUrl: string | null;
	/** Android's synthetic origin. `null` on iOS. */
	assetOrigin: string | null;
	/** The document's path inside the Android assets. */
	documentPath: string;
	/** Why it cannot be set up. `null` when it can. */
	unavailableReason: string | null;
}

export function describeNativeRuntimeHost(): NativeRuntimeHostDescriptor {
	const documentPath = `${RUNTIME_ASSET_DIR}/${RUNTIME_HARNESS_FILE}`;
	const unavailable = (reason: string): NativeRuntimeHostDescriptor => ({
		bridge: "unavailable",
		documentUrl: null,
		readAccessUrl: null,
		assetOrigin: null,
		documentPath,
		unavailableReason: reason,
	});

	const native = rowcatRuntimeNativeModule();
	if (native === null)
		return unavailable(
			"the rowcat-runtime-webview module isn't linked into this build",
		);

	if (Platform.OS === "android") {
		const origin = native.assetOrigin;
		if (origin === null) return unavailable("no asset origin");
		return {
			bridge: "android-webmessage",
			documentUrl: `${origin}/${documentPath}`,
			readAccessUrl: null,
			assetOrigin: origin,
			documentPath,
			unavailableReason: null,
		};
	}

	if (Platform.OS === "ios") {
		const documentUrl = native.assetOrigin;
		const readAccessUrl = native.readAccessUrl;
		if (documentUrl === null || readAccessUrl === null)
			return unavailable("couldn't find the runtime resource bundle");
		return {
			bridge: "ios-webview",
			documentUrl,
			readAccessUrl,
			assetOrigin: null,
			documentPath,
			unavailableReason: null,
		};
	}

	return unavailable(`${Platform.OS} has no trusted runtime WebView`);
}

/** One bridge for this device. If `unavailable`, a transport that never opens is created. */
export function createHostTransport(
	descriptor: NativeRuntimeHostDescriptor,
): NativeRuntimeTransport {
	const transport = createNativeRuntimeTransport(descriptor.bridge);
	if (descriptor.unavailableReason !== null)
		transport.fail(descriptor.unavailableReason);
	return transport;
}
