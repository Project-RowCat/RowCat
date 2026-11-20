cmake_minimum_required(VERSION 3.22.1)
project(afterstate_jni CXX)

set(VENDOR ${CMAKE_CURRENT_SOURCE_DIR}/../vendor)

add_library(afterstate_ffi SHARED IMPORTED)
set_target_properties(afterstate_ffi PROPERTIES
  IMPORTED_LOCATION ${VENDOR}/jniLibs/${ANDROID_ABI}/libafterstate_ffi.so)

add_library(afterstate_jni SHARED src/main/cpp/afterstate_jni.cpp)
target_include_directories(afterstate_jni PRIVATE ${VENDOR}/include)
target_link_libraries(afterstate_jni afterstate_ffi)
# 16 KB page alignment (Android 15+ 16 KB-page devices refuse 4 KB-aligned libraries).
target_link_options(afterstate_jni PRIVATE "-Wl,-z,max-page-size=16384")
