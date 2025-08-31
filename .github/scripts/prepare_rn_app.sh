#!/usr/bin/env bash
set -euxo pipefail

# Inputs
APP_NAME="shoonyawallet"
APP_DIR="$APP_NAME"
RN_VERSION="0.81.1"

# 1) Create RN app if not present (with fallbacks)
if [ ! -d "$APP_DIR" ]; then
  echo "Scaffolding React Native app via community CLI (RN $RN_VERSION)..."
  npx @react-native-community/cli init "$APP_NAME" --version "$RN_VERSION" || true
fi
if [ ! -d "$APP_DIR/android" ]; then
  echo "Fallback: scaffolding via react-native@$RN_VERSION..."
  npx react-native@${RN_VERSION} init "$APP_NAME" || true
fi
if [ ! -d "$APP_DIR/android" ]; then
  echo "ERROR: React Native scaffolding failed. Android project missing."
  ls -la "$APP_DIR" || true
  exit 1
fi

pushd "$APP_DIR"

# 2) Apply overlay (copy our src, config, and app shell)
rsync -a ../overlay/ ./

# 3) Install dependencies for app features and testing
npm pkg set name="shoonyawallet"
npm pkg set scripts.typecheck="tsc --noEmit"
npm pkg set scripts.lint="eslint ."
npm pkg set scripts.format="prettier --write ."
npm install --save @solana/web3.js bs58 @trezor/connect
npm install --save-dev @types/jest @testing-library/react-native @testing-library/jest-native jest-environment-jsdom

# 4) Android: ensure USB Host permission and device filter
MANIFEST=android/app/src/main/AndroidManifest.xml
if [ -f "$MANIFEST" ]; then
  # Add tools namespace if missing (for tools:ignore)
  if ! grep -q "xmlns:tools=\"http:\/\/schemas.android.com\/tools\"" "$MANIFEST"; then
    sed -i '0,/<manifest / s//<manifest xmlns:tools="http:\/\/schemas.android.com\/tools" /' "$MANIFEST"
  fi
  if ! grep -q "android.hardware.usb.host" "$MANIFEST"; then
    sed -i '0,/<application/ s//<uses-feature android:name="android.hardware.usb.host"\/>\n    <uses-permission android:name="android.permission.USB_PERMISSION" tools:ignore="MissingPrefix"\/>\n    <application/' "$MANIFEST"
  fi

  mkdir -p android/app/src/main/res/xml
  cat > android/app/src/main/res/xml/device_filter.xml <<'XML'
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <!-- Trezor devices (common vendor/product ids). Non-exhaustive. -->
    <usb-device vendor-id="21324" product-id="2145" />
    <usb-device vendor-id="21324" product-id="2144" />
    <usb-device vendor-id="4617" product-id="21441" />
</resources>
XML
  if ! grep -q "device_filter" "$MANIFEST"; then
    sed -i '0,/<application/ s//<application/; /<application/ a \\n+        <meta-data android:name="android.hardware.usb.action.USB_DEVICE_ATTACHED" android:resource="@xml/device_filter"\/>\n    ' "$MANIFEST"
  fi
else
  echo "WARN: AndroidManifest not found at $MANIFEST; skipping manifest patch."
fi

# 5) Opt-in strict RN types in tsconfig
if [ -f tsconfig.json ]; then
  node - <<'NODE'
const fs = require('fs');
try {
  const p = 'tsconfig.json';
  const j = JSON.parse(fs.readFileSync(p, 'utf8'));
  j.compilerOptions = j.compilerOptions || {};
  const types = new Set([...(j.compilerOptions.types || []), 'react-native/types/strict']);
  j.compilerOptions.types = Array.from(types);
  fs.writeFileSync(p, JSON.stringify(j, null, 2));
  console.log('Updated tsconfig types for strict RN API');
} catch (e) { console.error('tsconfig update failed', e); }
NODE
fi

# 6) Ensure lockfile and node_modules exist
if [ -f package-lock.json ]; then
  npm ci || npm install
else
  npm install
fi

popd

echo "Preparation complete. Android project is ready."
