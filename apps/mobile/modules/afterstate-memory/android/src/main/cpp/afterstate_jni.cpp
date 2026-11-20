// JNI shim over the afterstate-ffi C ABI.
//
// Strings cross as UTF-8 byte arrays, not jstring: JNI's GetStringUTFChars yields *modified*
// UTF-8 (supplementary characters such as emoji become 6-byte surrogate pairs), which the library
// rejects as invalid UTF-8. Kotlin encodes and decodes with Charsets.UTF_8.
#include <jni.h>

#include <cstring>
#include <string>

#include "afterstate_ffi.h"

namespace {

std::string bytes(JNIEnv* env, jbyteArray array) {
  const jsize n = env->GetArrayLength(array);
  std::string out(static_cast<size_t>(n), '\0');
  env->GetByteArrayRegion(array, 0, n, reinterpret_cast<jbyte*>(out.data()));
  return out;
}

jbyteArray to_java(JNIEnv* env, const char* text) {
  const jsize n = static_cast<jsize>(std::strlen(text));
  jbyteArray out = env->NewByteArray(n);
  if (out != nullptr) env->SetByteArrayRegion(out, 0, n, reinterpret_cast<const jbyte*>(text));
  return out;
}

}  // namespace

extern "C" {

JNIEXPORT jbyteArray JNICALL
Java_com_projectrowcat_afterstatememory_AfterstateNative_protocol(JNIEnv* env, jclass) {
  return to_java(env, afterstate_protocol());
}

// Returns the handle (> 0), or 0 with `error[0]` set to the message bytes.
JNIEXPORT jlong JNICALL Java_com_projectrowcat_afterstatememory_AfterstateNative_open(
    JNIEnv* env, jclass, jbyteArray config, jobjectArray error) {
  const std::string json = bytes(env, config);
  uint64_t handle = 0;
  char* message = nullptr;
  const int32_t status = afterstate_open(json.c_str(), &handle, &message);
  if (status != AFTERSTATE_OK) {
    if (message != nullptr) {
      env->SetObjectArrayElement(error, 0, to_java(env, message));
      afterstate_string_free(message);
    }
    return 0;
  }
  return static_cast<jlong>(handle);
}

JNIEXPORT jbyteArray JNICALL Java_com_projectrowcat_afterstatememory_AfterstateNative_call(
    JNIEnv* env, jclass, jlong handle, jbyteArray request) {
  const std::string json = bytes(env, request);
  char* out = afterstate_call(static_cast<uint64_t>(handle), json.c_str());
  if (out == nullptr) return nullptr;
  jbyteArray result = to_java(env, out);
  afterstate_string_free(out);
  return result;
}

JNIEXPORT jint JNICALL Java_com_projectrowcat_afterstatememory_AfterstateNative_cancel(
    JNIEnv*, jclass, jlong handle, jlong request) {
  return afterstate_cancel(static_cast<uint64_t>(handle), static_cast<uint64_t>(request));
}

JNIEXPORT jint JNICALL Java_com_projectrowcat_afterstatememory_AfterstateNative_close(
    JNIEnv*, jclass, jlong handle) {
  return afterstate_close(static_cast<uint64_t>(handle));
}

JNIEXPORT jint JNICALL Java_com_projectrowcat_afterstatememory_AfterstateNative_destroy(
    JNIEnv*, jclass, jlong handle, jint timeout_ms) {
  return afterstate_destroy(static_cast<uint64_t>(handle), static_cast<uint32_t>(timeout_ms));
}

}  // extern "C"
