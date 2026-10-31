import { useCallback, useEffect, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { WebView } from "react-native-webview";
import {
	rowcatRuntimeHostView,
	rowcatRuntimeNativeModule,
} from "../../../modules/rowcat-runtime-webview/index.ts";
import type { NativeRuntimeHostDescriptor } from "./host-bridge.ts";
import {
	RUNTIME_HOST_ORIGIN_WHITELIST,
	runtimeHostNavigationAllowed,
} from "./navigation-policy.ts";
import type { NativeRuntimeTransport } from "./transport.ts";

/**
 * The **place where the trusted runtime WebView is attached**. It is an execution environment, not
 * a screen.
 *
 * ```text
 * Android   rowcat-runtime-webview's native view · WebMessagePort
 * iOS       react-native-webview · file URL · injected script
 * ```
 *
 * Only a transparent 1×1 box is drawn. Creator UI is not drawn a single pixel here: what goes out
 * is patch bundles, and React Native draws the screen.
 *
 * **It is not detached.** A WebView that is not attached squeezes JS scheduling on both platforms,
 * which would make interaction latency a function of our layout rather than of the device.
 *
 * ## Only iOS evaluates scripts
 *
 * The Android production path has no `injectJavaScript` (the port is bidirectional). iOS uses the
 * bridge as-is: the measured simulator round trip is 4.5ms, already workable. Changing that
 * arrangement happens when a measurement demands it (`docs/creator-runtime/native-vm-host.md` §9).
 */

let nextHostId = 1;

/**
 * One WebView per transport. A session renews its transport when the old one died or stopped
 * answering (`session.ts`), and the new transport must land in a **new realm**: a stuck thread or a
 * crashed process cannot be reused, and reopening the same view would hand the fresh bridge to the
 * document that just hung. Keying on the transport's identity is what remounts it.
 */
const hostKeys = new WeakMap<NativeRuntimeTransport, number>();
let nextHostKey = 1;
const hostKeyFor = (transport: NativeRuntimeTransport): number => {
	let key = hostKeys.get(transport);
	if (key === undefined) {
		key = nextHostKey++;
		hostKeys.set(transport, key);
	}
	return key;
};

/**
 * The injected script. It wraps the message once more as a JS string literal, and the harness reads
 * it back with `JSON.parse`. Concatenating the value directly into code would make the value code
 * itself. The trailing `true` is the format react-native-webview requires.
 */
const injectionFor = (json: string): string =>
	`globalThis.__rowcatHarness && globalThis.__rowcatHarness.receive(${JSON.stringify(json)}); true;`;

export function NativeRuntimeHostView({
	descriptor,
	transport,
}: {
	descriptor: NativeRuntimeHostDescriptor;
	transport: NativeRuntimeTransport;
}) {
	const key = hostKeyFor(transport);
	if (descriptor.bridge === "android-webmessage")
		return (
			<AndroidHost key={key} descriptor={descriptor} transport={transport} />
		);
	if (descriptor.bridge === "ios-webview")
		return <IosHost key={key} descriptor={descriptor} transport={transport} />;
	return null;
}

function AndroidHost({
	descriptor,
	transport,
}: {
	descriptor: NativeRuntimeHostDescriptor;
	transport: NativeRuntimeTransport;
}) {
	const Host = rowcatRuntimeHostView();
	const native = rowcatRuntimeNativeModule();
	const hostId = useRef(0);
	if (hostId.current === 0) hostId.current = nextHostId++;

	useEffect(() => {
		if (Host === null || native === null) return;
		const id = hostId.current;
		transport.open((json) => native.send(id, json));
	}, [Host, native, transport]);

	if (Host === null || native === null || descriptor.assetOrigin === null)
		return null;
	return (
		<View style={host.hidden} pointerEvents="none">
			<Host
				hostId={hostId.current}
				assetOrigin={descriptor.assetOrigin}
				documentPath={descriptor.documentPath}
				onRuntimeMessage={(event) => transport.receive(event.nativeEvent.data)}
				onRuntimeTerminated={(event) =>
					transport.fail(event.nativeEvent.reason)
				}
				style={host.fill}
			/>
		</View>
	);
}

function IosHost({
	descriptor,
	transport,
}: {
	descriptor: NativeRuntimeHostDescriptor;
	transport: NativeRuntimeTransport;
}) {
	const webview = useRef<WebView | null>(null);

	const open = useCallback(() => {
		transport.open((json) => {
			webview.current?.injectJavaScript(injectionFor(json));
		});
	}, [transport]);

	useEffect(() => {
		open();
	}, [open]);

	if (descriptor.documentUrl === null || descriptor.readAccessUrl === null)
		return null;

	return (
		<View style={host.hidden} pointerEvents="none">
			{/**
			 * This WebView is an execution environment, not a screen, so it **cannot go anywhere.**
			 *
			 * Creator code runs inside QuickJS WASM, and that boundary is the real isolation. The props
			 * below are the second fence for when that boundary is breached: escaped code would land in a
			 * browser realm, so a one-document harness must be unable to navigate, open windows, or reach
			 * cookies and other files. Its requests are fenced by the document itself (`harness-document.ts`):
			 * the Content-Security-Policy for fetch, XHR, WebSocket and subresources, a prelude that deletes
			 * the WebRTC constructors from this realm's global (no CSP directive reaches ICE/STUN; a same-origin
			 * child frame still has its own, so this narrows rather than closes), and DNS prefetch turned off —
			 * WKWebView intercepts nothing on this path.
			 *
			 * `allowFileAccessFromFileURLs` being on is the one axis this slice loosened, and the price is
			 * that WASM does not cross the bridge as base64. The read-access scope is the single asset
			 * directory (`allowingReadAccessToURL`), and what lies inside it is only the two files we
			 * committed.
			 */}
			<WebView
				ref={webview}
				source={{ uri: descriptor.documentUrl }}
				/**
				 * `*`, so every URL reaches the decision below. A URL failing a narrower whitelist is not
				 * rejected by the library but handed to the OS (`navigation-policy.ts`).
				 */
				originWhitelist={RUNTIME_HOST_ORIGIN_WHITELIST}
				allowingReadAccessToURL={descriptor.readAccessUrl}
				allowFileAccessFromFileURLs
				allowUniversalAccessFromFileURLs={false}
				/** Navigation is allowed **only inside the asset directory**, whatever the scheme. */
				onShouldStartLoadWithRequest={(request) =>
					runtimeHostNavigationAllowed(request.url, descriptor.readAccessUrl)
				}
				setSupportMultipleWindows={false}
				javaScriptCanOpenWindowsAutomatically={false}
				thirdPartyCookiesEnabled={false}
				sharedCookiesEnabled={false}
				incognito
				allowFileAccess={false}
				allowsBackForwardNavigationGestures={false}
				javaScriptEnabled
				onMessage={(event) => transport.receive(event.nativeEvent.data)}
				onContentProcessDidTerminate={() =>
					transport.fail("content_process_terminated")
				}
				onError={(event) =>
					transport.fail(`webview_error: ${event.nativeEvent.description}`)
				}
				style={host.fill}
			/>
		</View>
	);
}

const host = StyleSheet.create({
	hidden: { width: 1, height: 1, opacity: 0 },
	fill: { flex: 1, backgroundColor: "transparent" },
});
