import { requireNativeModule, requireNativeView } from "expo";
import type { ComponentType } from "react";
import type { ViewProps } from "react-native";

/**
 * Native piece of the trusted creator runtime. Android: this module owns the WebView and bridges
 * through `WebMessagePort`. iOS: it only reports where the assets live; transport belongs to
 * `react-native-webview`.
 *
 * The surface has no arbitrary URL navigation and no arbitrary JavaScript evaluation. It opens four
 * things (`bridge`, `assetOrigin`, `readAccessUrl`, `send`) and that set is the policy; this is not
 * a general WebView component.
 *
 * Loading is lazy: `requireNativeModule` throws in a build where the module is not linked, so
 * calling it at module top level would crash a dev build that has not run `prebuild` at app start,
 * on a screen unrelated to the runtime. Calls happen inside functions and return `null` when
 * absent; the runtime then does not start (no alternate path is sought).
 */

export type RowcatRuntimeBridge = "android-webmessage" | "ios-webview";

export interface RowcatRuntimeWebViewNativeModule {
	/** This platform's bridge; also tells which path a measurement belongs to. */
	readonly bridge: RowcatRuntimeBridge;
	/**
	 * Document address: a synthetic origin on Android (`shouldInterceptRequest` serves app assets
	 * under it) and a file URL inside the resource bundle on iOS, `null` if iOS cannot find it.
	 */
	readonly assetOrigin: string | null;
	readonly assetDirectory: string;
	/** Read-access scope given to WKWebView; `null` on Android. */
	readonly readAccessUrl: string | null;
	/** Android only. Silently dropped if the channel is not open yet; the JS transport layer owns the queue. */
	send(hostId: number, message: string): void;
}

export interface RowcatRuntimeHostViewProps extends ViewProps {
	/** Number identifying this view; `send(hostId, …)` looks it up by it. */
	hostId: number;
	assetOrigin: string;
	documentPath: string;
	onRuntimeMessage?: (event: { nativeEvent: { data: string } }) => void;
	onRuntimeTerminated?: (event: { nativeEvent: { reason: string } }) => void;
}

let moduleCache: RowcatRuntimeWebViewNativeModule | null | undefined;

/** `null` when not linked; never throws. */
export function rowcatRuntimeNativeModule(): RowcatRuntimeWebViewNativeModule | null {
	if (moduleCache !== undefined) return moduleCache;
	try {
		moduleCache = requireNativeModule<RowcatRuntimeWebViewNativeModule>(
			"RowcatRuntimeWebView",
		);
	} catch {
		moduleCache = null;
	}
	return moduleCache;
}

let viewCache: ComponentType<RowcatRuntimeHostViewProps> | null | undefined;

/** Exists on Android only. */
export function rowcatRuntimeHostView(): ComponentType<RowcatRuntimeHostViewProps> | null {
	if (viewCache !== undefined) return viewCache;
	try {
		viewCache = requireNativeView<RowcatRuntimeHostViewProps>(
			"RowcatRuntimeWebView",
		);
	} catch {
		viewCache = null;
	}
	return viewCache;
}
