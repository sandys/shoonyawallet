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
cp -a ../overlay/. ./

# 3) Install dependencies for app features and testing
npm pkg set name="shoonyawallet"
npm pkg set scripts.typecheck="tsc --noEmit"
npm pkg set scripts.lint="eslint ."
npm pkg set scripts.format="prettier --write ."
npm install --save @solana/web3.js bs58 protobufjs
npm install --save-dev @types/jest @testing-library/react-native @testing-library/jest-native jest-environment-jsdom protobufjs-cli

# 4) Opt-in strict RN types in tsconfig
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

# 5) Ensure lockfile and node_modules exist
if [ -f package-lock.json ]; then
  npm ci || npm install
else
  npm install
fi

popd

echo "Preparation complete. Android project is ready."

# 7) Vendor Trezor proto files and generate descriptor (best-effort)
pushd "$APP_DIR"
mkdir -p src/services/hardware/trezor/protos
set +e
curl -fsSL https://raw.githubusercontent.com/trezor/trezor-firmware/master/common/protob/messages-solana.proto -o src/services/hardware/trezor/protos/messages-solana.proto
curl -fsSL https://raw.githubusercontent.com/trezor/trezor-firmware/master/common/protob/messages.proto -o src/services/hardware/trezor/protos/messages.proto
curl -fsSL https://raw.githubusercontent.com/trezor/trezor-firmware/master/common/protob/messages-common.proto -o src/services/hardware/trezor/protos/messages-common.proto
set -e
if [ -f src/services/hardware/trezor/protos/messages-solana.proto ]; then
  npx pbjs -t json \
    -o src/services/hardware/trezor/protos/descriptor.json \
    src/services/hardware/trezor/protos/messages-common.proto \
    src/services/hardware/trezor/protos/messages.proto \
    src/services/hardware/trezor/protos/messages-solana.proto || true
else
  echo "WARN: Could not fetch Trezor proto files; will fallback to minimal inline protos."
fi
popd

# 6) Patch MainApplication to register TrezorUsbPackage (Kotlin or Java)
APP_MAIN_KT="$APP_DIR/android/app/src/main/java/com/$APP_NAME/MainApplication.kt"
APP_MAIN_JAVA="$APP_DIR/android/app/src/main/java/com/$APP_NAME/MainApplication.java"
if [ -f "$APP_MAIN_KT" ]; then
  if ! grep -q "TrezorUsbPackage" "$APP_MAIN_KT"; then
    sed -i 's/import com.facebook.react.ReactApplication;/import com.facebook.react.ReactApplication;\nimport com.shoonyawallet.usb.TrezorUsbPackage;/' "$APP_MAIN_KT" || true
    sed -i '0,/.getPackages()/!b; :a; n; /listOf(/ { s/listOf(/listOf(\n            TrezorUsbPackage(),/; b }; ba' "$APP_MAIN_KT" || true
  fi
elif [ -f "$APP_MAIN_JAVA" ]; then
  if ! grep -q "TrezorUsbPackage" "$APP_MAIN_JAVA"; then
    sed -i 's/import com.facebook.react.ReactApplication;/import com.facebook.react.ReactApplication;\nimport com.shoonyawallet.usb.TrezorUsbPackage;/' "$APP_MAIN_JAVA" || true
    sed -i '0,/new PackageList(this).getPackages()/ s//new PackageList(this).getPackages();\n        packages.add(new TrezorUsbPackage());/' "$APP_MAIN_JAVA" || true
  fi
else
  echo "WARN: MainApplication not found for package registration; you may need to manually add TrezorUsbPackage."
fi
