#!/usr/bin/env bash
# Build a standalone Android APK locally (no EAS). Output lands in apps/mobile/dist/.
#
# Prereqs (one-time):
#   - Android Studio + Android SDK (set ANDROID_HOME / ANDROID_SDK_ROOT)
#   - JDK 17 (Temurin 17 works well)
#   - From apps/mobile: `npm install`
#
# The API URL is inlined at build time. Point it at your HTTPS tunnel (or bake a
# placeholder and set the real URL later from the in-app Settings screen):
#   EXPO_PUBLIC_API_URL=https://<tunnel-host> scripts/build-android.sh
#
# Install the result on an emulator or a USB-debugging device:
#   adb install -r apps/mobile/dist/aishorts-release.apk
set -euo pipefail

cd "$(dirname "$0")/../apps/mobile"

: "${EXPO_PUBLIC_API_URL:=http://localhost:4000}"
export EXPO_PUBLIC_API_URL
echo "Building with EXPO_PUBLIC_API_URL=${EXPO_PUBLIC_API_URL}"
echo "(You can change the backend URL later in the app's Settings screen.)"

echo "1/3  Generating the native android project (expo prebuild)..."
npx expo prebuild -p android --no-install

echo "2/3  Assembling a release APK (gradlew assembleRelease)..."
# Debug signing keys ship with the RN template — fine for side-loading test builds.
# For Play Store upload you must generate and configure a real upload keystore
# (see DEPLOY.md). This produces an installable, unsigned-for-store APK.
( cd android && ./gradlew assembleRelease )

echo "3/3  Copying APK to dist/ ..."
mkdir -p dist
APK="$(find android/app/build/outputs/apk/release -name '*.apk' | head -n1)"
if [ -z "${APK}" ]; then
  echo "No APK produced — check the gradle output above." >&2
  exit 1
fi
cp "${APK}" dist/aishorts-release.apk

echo "Done. APK at: apps/mobile/dist/aishorts-release.apk"
echo "Install:  adb install -r apps/mobile/dist/aishorts-release.apk"
