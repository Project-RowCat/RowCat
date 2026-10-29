package com.projectrowcat.runtimewebview

import android.annotation.SuppressLint
import android.content.Context
import android.net.Uri
import android.os.Build
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.annotation.RequiresApi
import androidx.webkit.WebMessageCompat
import androidx.webkit.WebMessagePortCompat
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.io.IOException

/**
 * The trusted runtime WebView: **an execution environment, not a screen.**
 *
 * ```text
 * Hermes  ──WebMessagePort──▶  this WebView  ──▶  QuickJS/WASM  ──▶  creator code
 *         ◀─────────────────
 * ```
 *
 * Not one pixel of creator UI is drawn here. The view is attached at 1×1 (detached, Android
 * throttles that WebView's JS scheduling) and draws nothing; what leaves it is patch bundles, and
 * React Native draws the screen.
 *
 * ## Why this module exists
 *
 * `react-native-webview` does not expose `WebViewCompat.createWebMessageChannel`. Without that API
 * the only path left is `injectJavaScript`, the slowest bridge, which **evaluates a script on the
 * UI thread for every call** (68 ms round trip measured on an emulator —
 * `docs/creator-runtime/native-vm-host.md` §7). That one line is why this file exists.
 *
 * ## There is no silent fallback
 *
 * A device that cannot set up a `WebMessagePort` does **not** fall back to `injectJavaScript`.
 * That fallback would quietly return the production path to the slowest bridge and, above all,
 * leave measurements unable to say which path they came from. Failing to set it up ends in a
 * structured failure.
 *
 * ## This WebView goes nowhere
 *
 * The document is one app asset and every other navigation is refused. Asset requests accept only
 * names under `runtime/`: the second fence if creator code ever escapes into this realm (the first
 * is WASM linear memory, which is the real isolation).
 */
@SuppressLint("SetJavaScriptEnabled")
class RowcatRuntimeHostView(context: Context, appContext: AppContext) :
  ExpoView(context, appContext) {

  private val onRuntimeMessage by EventDispatcher()
  private val onRuntimeTerminated by EventDispatcher()

  private val webView = WebView(context)
  private var nativePort: WebMessagePortCompat? = null
  private var hostId: Int = 0
  private var origin: String = DEFAULT_ORIGIN
  private var documentPath: String = "$ASSET_DIR/harness.html"
  private var channelOpened = false
  private var released = false

  init {
    addView(webView, ViewGroup.LayoutParams(1, 1))
    webView.settings.apply {
      javaScriptEnabled = true
      domStorageEnabled = false
      allowFileAccess = false
      allowContentAccess = false
      javaScriptCanOpenWindowsAutomatically = false
      setSupportMultipleWindows(false)
      mediaPlaybackRequiresUserGesture = true
      cacheMode = WebSettings.LOAD_NO_CACHE
    }
    CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false)
    webView.webViewClient = object : WebViewClient() {
      override fun shouldInterceptRequest(
        view: WebView,
        request: WebResourceRequest
      ): WebResourceResponse? = serve(request.url)

      /** A one-document realm: no navigation ever happens. */
      override fun shouldOverrideUrlLoading(
        view: WebView,
        request: WebResourceRequest
      ): Boolean = true

      override fun onPageFinished(view: WebView, url: String) {
        openChannel()
      }

      /**
       * The renderer process died: **the session is lost, not the app.**
       *
       * Without returning `true`, Android kills the app process along with it. The VM heap lived
       * in that process, so there is nothing to recover: report upward and discard this view.
       */
      @RequiresApi(Build.VERSION_CODES.O)
      override fun onRenderProcessGone(
        view: WebView,
        detail: RenderProcessGoneDetail
      ): Boolean {
        terminate(if (detail.didCrash()) "render_process_crashed" else "render_process_killed")
        return true
      }
    }
  }

  fun setHostId(value: Int) {
    if (hostId != 0) REGISTRY.remove(hostId)
    hostId = value
    if (value != 0) REGISTRY[value] = this
  }

  fun setOrigin(value: String) {
    origin = value
  }

  fun setDocumentPath(value: String) {
    documentPath = value
  }

  /** Called once after every prop has arrived; Expo delivers props one at a time, so loading starts here. */
  fun load() {
    if (released || channelOpened) return
    val html = try {
      context.assets.open(documentPath).use { it.readBytes().toString(Charsets.UTF_8) }
    } catch (error: IOException) {
      terminate("harness_asset_missing: ${error.message}")
      return
    }
    /**
     * Load as a document with an origin. Under `about:blank` there is no same origin, so the WASM
     * cannot be fetched and there is no target origin to hand the port to.
     */
    webView.loadDataWithBaseURL("$origin/$documentPath", html, "text/html", "utf-8", null)
  }

  fun send(message: String) {
    val port = nativePort ?: return
    port.postMessage(WebMessageCompat(message))
  }

  fun release() {
    if (released) return
    released = true
    if (hostId != 0) REGISTRY.remove(hostId)
    nativePort?.close()
    nativePort = null
    webView.stopLoading()
    webView.webViewClient = WebViewClient()
    removeView(webView)
    webView.destroy()
  }

  override fun onDetachedFromWindow() {
    super.onDetachedFromWindow()
    release()
  }

  private fun terminate(reason: String) {
    if (released) return
    onRuntimeTerminated(mapOf("reason" to reason))
    release()
  }

  private fun openChannel() {
    if (channelOpened || released) return
    for (feature in REQUIRED_FEATURES) {
      if (!WebViewFeature.isFeatureSupported(feature)) {
        terminate("web_message_channel_unsupported: $feature")
        return
      }
    }
    channelOpened = true
    val channel = WebViewCompat.createWebMessageChannel(webView)
    val native = channel[0]
    native.setWebMessageCallback(object : WebMessagePortCompat.WebMessageCallbackCompat() {
      override fun onMessage(port: WebMessagePortCompat, message: WebMessageCompat?) {
        val data = message?.data ?: return
        onRuntimeMessage(mapOf("data" to data))
      }
    })
    nativePort = native
    WebViewCompat.postWebMessage(
      webView,
      WebMessageCompat(PORT_HANDSHAKE, arrayOf(channel[1])),
      Uri.parse(origin)
    )
  }

  /**
   * Serves app assets only; any other request is **blocked, not passed through.**
   *
   * Narrowed by a prefix and a character check rather than a name allowlist. A path containing
   * `..` cannot climb out of the asset manager anyway, but this does not rely on that.
   */
  private fun serve(url: Uri): WebResourceResponse {
    val expected = Uri.parse(origin)
    if (url.scheme != expected.scheme || url.host != expected.host) return blocked()
    val path = url.path?.removePrefix("/") ?: return blocked()
    if (!path.startsWith("$ASSET_DIR/") || path.contains("..")) return blocked()
    return try {
      WebResourceResponse(
        mimeFor(path),
        "utf-8",
        200,
        "OK",
        mapOf("Cache-Control" to "no-store"),
        context.assets.open(path)
      )
    } catch (error: IOException) {
      WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), null)
    }
  }

  private fun blocked(): WebResourceResponse =
    WebResourceResponse("text/plain", "utf-8", 403, "Forbidden", emptyMap(), null)

  private fun mimeFor(path: String): String = when {
    path.endsWith(".html") -> "text/html"
    path.endsWith(".wasm") -> "application/wasm"
    else -> "application/octet-stream"
  }

  companion object {
    const val DEFAULT_ORIGIN = "https://appassets.rowcat.invalid"
    const val ASSET_DIR = "runtime"
    const val PORT_HANDSHAKE = "__rowcat_port__"

    /**
     * `hostId → view`: where the module's `send` finds its view.
     *
     * One integer instead of a view ref keeps the wiring to one path. If the moment a ref becomes
     * ready on the JavaScript side and the moment sending starts were to diverge, messages sent in
     * that window would vanish without an error.
     */
    private val REGISTRY = mutableMapOf<Int, RowcatRuntimeHostView>()

    fun find(hostId: Int): RowcatRuntimeHostView? = REGISTRY[hostId]

    private val REQUIRED_FEATURES = listOf(
      WebViewFeature.CREATE_WEB_MESSAGE_CHANNEL,
      WebViewFeature.POST_WEB_MESSAGE,
      WebViewFeature.WEB_MESSAGE_PORT_POST_MESSAGE,
      WebViewFeature.WEB_MESSAGE_PORT_SET_MESSAGE_CALLBACK,
      WebViewFeature.WEB_MESSAGE_PORT_CLOSE
    )
  }
}
