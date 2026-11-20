cmake_minimum_required(VERSION 3.22.1)
project(afterstate_jni CXX)

set(VENDOR ${CMAKE_CURRENT_SOURCE_DIR}/../vendor)

add_library(afterstate_ffi SHARED IMPORTED)
# The Rust cdylib carries no DT_SONAME. Without IMPORTED_NO_SONAME the linker records the path it was
# given ("../../../../../vendor/jniLibs/<abi>/libafterstate_ffi.so") as the shim's DT_NEEDED, and the
# Android loader cannot resolve that inside the APK: `System.loadLibrary("afterstate_jni")` fails,
# the Expo module never registers, and the app silently runs on memory V2 (`hasNativeAfterstate()`
# false). With it, CMake links by name (-L<dir> -lafterstate_ffi) and DT_NEEDED is the bare file name.
set_target_properties(afterstate_ffi PROPERTIES
  IMPORTED_LOCATION ${VENDOR}/jniLibs/${ANDROID_ABI}/libafterstate_ffi.so
  IMPORTED_NO_SONAME TRUE)

add_library(afterstate_jni SHARED src/main/cpp/afterstate_jni.cpp)
target_include_directories(afterstate_jni PRIVATE ${VENDOR}/include)
target_link_libraries(afterstate_jni afterstate_ffi)
# 16 KB page alignment (Android 15+ 16 KB-page devices refuse 4 KB-aligned libraries).
target_link_options(afterstate_jni PRIVATE "-Wl,-z,max-page-size=16384")
