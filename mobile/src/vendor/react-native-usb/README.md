# @trezor/react-native-usb (Vendored)

This is a vendored copy of Trezor's React Native USB library from their official suite repository.

**Source**: https://github.com/trezor/trezor-suite/tree/912b13b214433364cf322ff1448e0978be98b714/packages/react-native-usb

## Purpose

This library provides native USB communication for React Native apps on Android. It's used by Trezor's official Suite mobile app for hardware wallet communication.

## Platform Support

- ✅ **Android**: Full USB host support using native Android USB APIs
- ❌ **iOS**: Not supported (iOS doesn't support USB host mode)

## Architecture

### Android Implementation
- Native Kotlin module using Android USB Host APIs
- Expo modules framework
- Direct device communication without browser dependencies

### Key Features
- Device enumeration and permission management
- USB interface claiming/releasing
- Bulk transfer operations (transferIn/transferOut)
- Device connection/disconnection event handling
- Priority mode to prevent device closure during critical operations

## Usage

```typescript
import { getDevices, onDeviceConnected, WebUSB } from './src/vendor/react-native-usb';

// Get available devices
const devices = await getDevices();

// Listen for device connections
const subscription = onDeviceConnected((device) => {
  console.log('Device connected:', device);
});

// Open and communicate with device
await device.open();
await device.claimInterface(0);
const result = await device.transferOut(1, data);
```

## Integration Notes

This is a vendored library that requires:
1. Expo modules infrastructure 
2. Android USB permissions in AndroidManifest.xml
3. Native build configuration

The library is designed to work with the existing Trezor protocol stack and provides a WebUSB-like interface for compatibility.