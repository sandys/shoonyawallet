#!/usr/bin/env bash
set -euxo pipefail

# Inputs
APP_NAME="shoonyawallet"
APP_DIR="$APP_NAME"

# 1) Create RN app if not present
if [ ! -d "$APP_DIR" ]; then
  npx @react-native-community/cli init "$APP_NAME"
fi

pushd "$APP_DIR"

# 2) Apply overlay (copy our src, config, and app shell)
rsync -a ../overlay/ ./

# 3) Install dependencies for app features and testing
npm pkg set name="shoonyawallet"
npm pkg set scripts.typecheck="tsc --noEmit"
npm pkg set scripts.lint="eslint ."
npm pkg set scripts.format="prettier --write ."
npm install --save @solana/web3.js bs58
npm install --save-dev @types/jest @testing-library/react-native @testing-library/jest-native jest-environment-jsdom

# Optional: Android USB helper (placeholder; implement native usage later if needed)
# npm install --save react-native-usb

# 4) Android: ensure USB Host permission and BLE permissions in Manifest
MANIFEST=android/app/src/main/AndroidManifest.xml
if ! grep -q "android.hardware.usb.host" "$MANIFEST"; then
  sed -i '0,/<application/ s//<uses-feature android:name="android.hardware.usb.host"\/>\n    <uses-permission android:name="android.permission.USB_PERMISSION" tools:ignore="MissingPrefix"\/>\n    <application/' "$MANIFEST"
fi

# Add tools namespace if missing (for tools:ignore)
if ! grep -q "xmlns:tools=\"http:\/\/schemas.android.com\/tools\"" "$MANIFEST"; then
  sed -i '0,/<manifest / s//<manifest xmlns:tools="http:\/\/schemas.android.com\/tools" /' "$MANIFEST"
fi

# 5) iOS: install pods
if command -v pod >/dev/null 2>&1; then
  pushd ios
  pod install --repo-update || pod install
  popd
fi

popd

echo "Preparation complete. You can now build Android/iOS."

