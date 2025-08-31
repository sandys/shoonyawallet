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
# Declare deps in package.json so installs are centralized
npm pkg set dependencies."@solana/web3.js"="^1.95.0"
npm pkg set dependencies.bs58="^5.0.0"
npm pkg set dependencies.protobufjs="^7.2.6"
npm pkg set dependencies."@react-native-clipboard/clipboard"="^1.11.1"
npm pkg set devDependencies."@types/jest"="^29.5.12"
npm pkg set devDependencies."@testing-library/react-native"="^12.5.2"
npm pkg set devDependencies."@testing-library/jest-native"="^5.0.0"
npm pkg set devDependencies."jest-environment-jsdom"="^29.7.0"
npm pkg set devDependencies."protobufjs-cli"="^1.1.1"

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
npm install

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

# 8) Ensure native USB module is registered in MainApplication
MAIN_KT=$(ls "$APP_DIR"/android/app/src/main/java/**/MainApplication.kt 2>/dev/null | head -n1 || true)
MAIN_JAVA=$(ls "$APP_DIR"/android/app/src/main/java/**/MainApplication.java 2>/dev/null | head -n1 || true)
if [ -n "$MAIN_KT" ]; then
  if ! grep -q "com.shoonyawallet.usb.TrezorUsbPackage" "$MAIN_KT"; then
    sed -i '0,/package / s//&\nimport com.shoonyawallet.usb.TrezorUsbPackage;/' "$MAIN_KT" || true
  fi
  if grep -q "return packages" "$MAIN_KT" && ! grep -q "TrezorUsbPackage()" "$MAIN_KT"; then
    sed -i '0,/return packages/ s//            packages.add(TrezorUsbPackage())\n            return packages/' "$MAIN_KT" || true
  fi
fi
if [ -n "$MAIN_JAVA" ]; then
  if ! grep -q "com.shoonyawallet.usb.TrezorUsbPackage" "$MAIN_JAVA"; then
    sed -i '0,/package / s//&\nimport com.shoonyawallet.usb.TrezorUsbPackage;/' "$MAIN_JAVA" || true
  fi
  if grep -q "return packages;" "$MAIN_JAVA" && ! grep -q "new TrezorUsbPackage()" "$MAIN_JAVA"; then
    sed -i '0,/return packages;/ s//        packages.add(new TrezorUsbPackage());\n        return packages;/' "$MAIN_JAVA" || true
  fi
fi

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
