import ExpoModulesCore

/**
 * The trusted runtime assets on iOS: **no transport.**
 *
 * What this module does on Android (owning the WebView, the `WebMessagePort` bridge) does not
 * happen here. On this platform `react-native-webview` is already a usable bridge (4.5 ms host
 * round trip measured on a simulator — `docs/creator-runtime/native-vm-host.md` §2b), and the
 * bridge changes only when a measurement asks for it.
 *
 * One thing remains: **where the harness and the WASM sit inside the app bundle.** Both must be
 * files. WKWebView has to load the document from a file URL to fetch the WASM from the same
 * directory, and that is the only way not to push the bytes across the bridge as base64.
 */
public class RowcatRuntimeWebViewModule: Module {
  public func definition() -> ModuleDefinition {
    Name("RowcatRuntimeWebView")

    Constants([
      "bridge": "ios-webview",
      "assetDirectory": "runtime",
      /** The document's address. `nil` when the bundle is missing, and then the runtime does not start. */
      "assetOrigin": Self.runtimeDirectory()?.appendingPathComponent("harness.html").absoluteString,
      /** The read-access scope given to WKWebView; nothing outside this directory opens. */
      "readAccessUrl": Self.runtimeDirectory()?.absoluteString
    ])
  }

  /**
   * `runtime/` inside the resource bundle.
   *
   * The bundle name must equal the podspec's `resource_bundles` key. If they diverge this
   * function answers `nil` and the runtime ends in a **start failure** (it does not quietly look
   * for another path).
   */
  private static func runtimeDirectory() -> URL? {
    let container = Bundle(for: RowcatRuntimeWebViewModule.self)
    guard
      let bundleUrl = container.url(forResource: "RowcatRuntimeAssets", withExtension: "bundle"),
      let bundle = Bundle(url: bundleUrl)
    else { return nil }
    return bundle.bundleURL.appendingPathComponent("runtime", isDirectory: true)
  }
}
