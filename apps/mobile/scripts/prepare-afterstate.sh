#!/usr/bin/env bash
# Builds the afterstate engine for iOS and Android and vendors it into
# modules/afterstate-memory/vendor/ (gitignored).
#
#   AFTERSTATE_DIR=../afterstate apps/mobile/scripts/prepare-afterstate.sh [ios] [android]
#
# AFTERSTATE_DIR defaults to a sibling checkout at ../../rust/afterstate relative to the repository.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
repo="$(cd "$here/../.." && pwd)"
AFTERSTATE_DIR="${AFTERSTATE_DIR:-$repo/../../rust/afterstate}"
vendor="$here/modules/afterstate-memory/vendor"
"$AFTERSTATE_DIR/scripts/build-mobile.sh" "$@"
mkdir -p "$vendor/include"
cp "$AFTERSTATE_DIR/crates/afterstate-ffi/include/afterstate_ffi.h" "$vendor/include/"
out="$AFTERSTATE_DIR/target/mobile"
if [[ -d "$out/AfterstateFFI.xcframework" ]]; then
  rm -rf "$vendor/AfterstateFFI.xcframework"
  cp -R "$out/AfterstateFFI.xcframework" "$vendor/"
fi
if [[ -d "$out/jniLibs" ]]; then
  rm -rf "$vendor/jniLibs"
  cp -R "$out/jniLibs" "$vendor/"
fi
echo "vendored into $vendor"
