package com.projectrowcat.afterstatememory

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import org.json.JSONObject

/** JNI entry points (`afterstate_jni.cpp`). Strings cross as UTF-8 bytes; see the shim's header. */
internal object AfterstateNative {
  init {
    System.loadLibrary("afterstate_jni")
  }

  @JvmStatic external fun protocol(): ByteArray

  @JvmStatic external fun open(config: ByteArray, error: Array<ByteArray?>): Long

  @JvmStatic external fun call(handle: Long, request: ByteArray): ByteArray?

  @JvmStatic external fun cancel(handle: Long, request: Long): Int

  @JvmStatic external fun close(handle: Long): Int

  @JvmStatic external fun destroy(handle: Long, timeoutMs: Int): Int
}

/**
 * The afterstate engine's JSON bridge, exposed to JS.
 *
 * Expo runs `AsyncFunction`s off the main thread, so engine work never blocks rendering. Storage is
 * `noBackupFilesDir/afterstate/`: app-private and excluded from Auto Backup (the index is derived
 * and rebuilt from RowCat's records; a cloud backup would only add another plaintext copy). One file
 * per member; the library derives its name from the member id.
 */
class AfterstateMemoryModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AfterstateMemory")

    Constant("protocol") { String(AfterstateNative.protocol(), Charsets.UTF_8) }

    AsyncFunction("open") { user: String ->
      val context = appContext.reactContext ?: throw CodedException("no context")
      val dir = File(context.noBackupFilesDir, "afterstate").apply { mkdirs() }
      val config =
          JSONObject()
              .put(
                  "store",
                  JSONObject().put("user", JSONObject().put("dir", dir.absolutePath).put("user", user)))
              .put("read_connections", 1)
      val error = arrayOfNulls<ByteArray>(1)
      val handle = AfterstateNative.open(config.toString().toByteArray(Charsets.UTF_8), error)
      if (handle == 0L) {
        throw CodedException(error[0]?.toString(Charsets.UTF_8) ?: "open failed")
      }
      handle.toDouble()
    }

    AsyncFunction("call") { handle: Double, request: String ->
      val out =
          AfterstateNative.call(handle.toLong(), request.toByteArray(Charsets.UTF_8))
              ?: throw CodedException("no response")
      String(out, Charsets.UTF_8)
    }

    AsyncFunction("cancel") { handle: Double, request: Double ->
      AfterstateNative.cancel(handle.toLong(), request.toLong())
    }

    AsyncFunction("close") { handle: Double -> AfterstateNative.close(handle.toLong()) }

    AsyncFunction("destroy") { handle: Double -> AfterstateNative.destroy(handle.toLong(), 5_000) }
  }
}
