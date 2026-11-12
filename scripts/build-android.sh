#!/usr/bin/env bash
# Builds the signed Android APK (arm64, which covers practically every current tablet).
#   bash scripts/build-android.sh
#
# Tauri normally symlinks the compiled Rust library into the Android project, which Windows only
# allows in Developer Mode. Without it that step fails, so this script copies the library instead
# and runs the Gradle packaging step itself.
set -e
cd "$(dirname "$0")/.."
source scripts/android-env.sh

echo "== Compiling Folio for Android (the final symlink step may fail; that's expected)"
npx tauri android build --apk --target aarch64 || true

LIB=src-tauri/target/aarch64-linux-android/release/libfolio_lib.so
JNI=src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a
[ -f "$LIB" ] || { echo "Rust build failed: $LIB not found"; exit 1; }
mkdir -p "$JNI"
rm -f "$JNI/libfolio_lib.so"
cp "$LIB" "$JNI/"

echo "== Packaging and signing the APK"
cd src-tauri/gen/android
./gradlew.bat assembleArm64Release -x rustBuildArm64Release --console=plain -q

APK=app/build/outputs/apk/arm64/release/app-arm64-release.apk
VERSION=$(node -p "require('../../../package.json').version")
OUT="../../../Folio-$VERSION-android.apk"
cp "$APK" "$OUT"
echo "== Done: $(cd ../../.. && pwd)/Folio-$VERSION-android.apk"
