package com.projectrowcat.runtimewebview

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The trusted runtime WebView module: **not a general-purpose WebView API.**
 *
 * It exposes four things only: the bridge kind, the document's address, sending a message, and the
 * view that owns the WebView. Neither arbitrary URL navigation nor arbitrary JavaScript evaluation
 * is on the surface. The moment either opens, this module becomes a browser component rather than
 * a "trusted runtime host", and nobody can answer what runs in this realm.
 *
 * The iOS counterpart (`ios/RowcatRuntimeWebViewModule.swift`) **has no transport.** On that
 * platform `react-native-webview` is already a usable bridge (4.5 ms round trip measured on a
 * simulator), and changing that arrangement is not something this slice was asked to do.
 */
class RowcatRuntimeWebViewModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("RowcatRuntimeWebView")

    Constant("bridge") { "android-webmessage" }
    Constant("assetOrigin") { RowcatRuntimeHostView.DEFAULT_ORIGIN }
    Constant("assetDirectory") { RowcatRuntimeHostView.ASSET_DIR }
    /** Only iOS provides a file directory; Android's assets sit behind an origin. */
    Constant("readAccessUrl") { null as String? }

    /**
     * This call **has no queue.** If the channel is not open yet the message is dropped quietly;
     * the queue belongs to the JavaScript transport layer, since two queues would mean two orders.
     */
    Function("send") { hostId: Int, message: String ->
      RowcatRuntimeHostView.find(hostId)?.send(message)
    }

    View(RowcatRuntimeHostView::class) {
      Events("onRuntimeMessage", "onRuntimeTerminated")

      Prop("hostId") { view: RowcatRuntimeHostView, value: Int ->
        view.setHostId(value)
      }
      Prop("assetOrigin") { view: RowcatRuntimeHostView, value: String ->
        view.setOrigin(value)
      }
      Prop("documentPath") { view: RowcatRuntimeHostView, value: String ->
        view.setDocumentPath(value)
      }

      /** Load after every prop has arrived, not once per prop. */
      OnViewDidUpdateProps { view: RowcatRuntimeHostView ->
        view.load()
      }

      OnViewDestroys { view: RowcatRuntimeHostView ->
        view.release()
      }
    }
  }
}
