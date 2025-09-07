# Project Context and Session Summary (sifar)

This document captures the current architecture, key decisions, and a retrospective summary of the work completed in this session to get Trezor hardware address discovery working reliably on Android with strong, copyable diagnostics, and a coherent in‑app UI.

## Executive Summary

- Platform: Android only. iOS is out of scope for WebUSB.
- Purpose: Use Trezor hardware wallets as a signing/verification bridge with a “provably dumb” app that never handles private keys.
- Final approach: WebUSB via Chrome Custom Tabs (CCT) to a localhost page served by an embedded HTTP server. The app remains the UX; Chrome is the transport.
- Name: App renamed to “sifar” across Android/iOS; Android package id is `app.sifar`.
- UX: Minimal “Address Discovery” UI with proper inputs and clear read‑only styling; persistent, noisy logs with one‑click copy.

## Architecture (Current)

- Embedded local HTTP server: `@dr.pogodin/react-native-static-server`
  - Serves a self‑contained Trezor handler page at `http://localhost:<port>/trezor.html`.
  - The HTML is embedded in `App.tsx` and written to `DocumentDirectoryPath/trezor_handler/trezor.html` at runtime.

- Trezor Handler Page (HTML string in `App.tsx`)
  - Loads `https://connect.trezor.io/9/trezor-connect.js`.
  - Initializes with `{ popup: false, lazyLoad: false, debug: true }`.
  - Supports actions: `eth_getAddress`, `eth_signTransaction`, `eth_getAddressList`, `getFeatures`.
  - On completion, redirects to deep link `sifar://trezor-callback?status=...&data=...` with URL‑encoded JSON.

- Chrome Custom Tabs
  - Preferred path: Partial‑height CCT (embedded bottom sheet) via a tiny native module (`ChromeTabsModule`) to avoid full‑screen takeovers.
  - Fallback path(s): Standard `react-native-inappbrowser-reborn` Custom Tab; ultimately `Linking.openURL`.
  - All interactions remain in the app; the tab is strictly a WebUSB transport bridge.

- Deep Link Handling
  - AndroidManifest intent filter for `sifar://trezor-callback`.
  - `Linking` listener parses results, resolves pending CCT requests, and closes the tab.

- Inline WebView (for logging only)
  - The embedded WebView mirrors console/log errors but is not used for WebUSB (Android WebView lacks WebUSB; “Iframe timeout” is expected).

## UX and Logging

- Address Discovery (single screen)
  - Read‑only derivation prefix box. Preset button: “Use Trezor Default” → `m/44'/60'/0'/0/` (ETH).
  - Numeric inputs: “Start index” (the `i` in `.../i`) and “Count” (# of addresses to list).
  - Primary action: “Fetch Addresses” (uses CCT + localhost + Trezor Connect).
  - Address results display as read‑only pills; selecting an active address can be added next.

- Logging
  - Persistent across actions; only “Clear Logs” empties the buffer.
  - Full ISO timestamps; levels `[INFO]/[WARN]/[ERROR]`; WebView logs mirrored as `[WV INFO]/[WV ERROR]`.
  - “Copy Logs” includes a diagnostic header (platform, phase, WebView ready, pending requests, next req id, current ETH address) and the entire session log (buffered up to 2,000 lines).
  - “Dump State” writes a one‑line snapshot to the logs for debugging.

## Retrospective: What We Tried and Why We Landed Here

1) Native USB transport (legacy): Abandoned due to frequent device connection failures and maintenance burden.

2) WebView + Trezor Connect: Implemented for experimentation, but WebUSB isn’t available in Android WebView; Connect initialization ends with `Iframe timeout`. Kept as a logging surface only.

3) Localhost + Custom Tabs (CCT): Adopted to ensure WebUSB works reliably via Chrome:
   - First attempt used `react-native-static-server` (legacy); required patching (Gradle 8 issues).
   - Next tried `react-native-http-bridge`; it depended on very old Gradle tooling (`com.android.tools.build:gradle:2.2.0`), failing the build.
   - Final solution: `@dr.pogodin/react-native-static-server` (actively maintained; Gradle 8 friendly) + `@dr.pogodin/react-native-fs` to write a single handler HTML file.
   - Added a small Android native module to open Partial Custom Tabs (bottom sheet) for an embedded feel.

4) Build/CI Hardening:
   - App renamed to `sifar` across Android/iOS; fully qualified Android class names; deep link intent filter added.
   - Strict `npm ci` on CI; removed fallback installs; eliminated patch-package dependency by using maintained libraries.
   - Reworked earlier Gradle afterEvaluate hacks to avoid conflicts with AGP 8.

5) Testing Improvements:
   - Jest mocks for `react-native-webview`, `@dr.pogodin/react-native-static-server`, `@dr.pogodin/react-native-fs`, and `react-native-inappbrowser-reborn`.
   - A `webusb_bridge.test.tsx` triggers a test‑only button to exercise the WV path deterministically.
   - All tests pass locally with `--ci` flags.

## Rationale Behind Key Decisions

- WebUSB must run in Chrome; WebView is insufficient on Android. CCT allows a secure origin (localhost) where WebUSB is permitted.
- Partial Custom Tabs maintain an app‑embedded feel and avoid user distraction; they return via deep link automatically.
- Self‑contained: We serve the handler from the device (no external hosting). Using a maintained static server avoids patching and Gradle breakage.
- Transparent & safe: The app only relays and displays data; the device performs signing; we log aggressively for visibility.

## Current Status

- Address discovery via CCT + localhost works (Android, Trezor).
- Inline WebView provides logs (expected “Iframe timeout” for WebUSB there).
- UI is coherent: inputs are true inputs; read‑only data looks read‑only; one clear action.
- Logs persist across the session and are copyable with a diagnostic header.
- Tests pass locally; CI should be green with strict `npm ci`.

## Known Limitations / Caveats

- iOS: WebUSB is not supported; the entire flow is Android only.
- Local file write: We write one HTML file to `DocumentDirectoryPath` to serve it; this is simple and robust. If strictly no writes are desired, we can explore asset extraction or another in‑memory server that supports dynamic routes.
- Partial Custom Tabs: Requires newer `androidx.browser`; on some devices it may fall back to standard tabs.

## Next Steps (Proposed)

- Address discovery UX
  - Add “Show on Trezor” toggle to display each fetched address on device.
  - Validate and clamp Start (≥ 0) and Count (e.g., 1–20), with inline hints.
  - Allow selecting an address as “Active account” and surface it prominently.

- Protocol integration
  - Wire WalletConnect v2 (session, read‑only RPC, signing) to dispatch to the CCT flow for any hardware actions.
  - Add `signMessage` and other required methods to the handler page.

- CCT polish
  - Tune height and animations to match app styling; hide more chrome if desired.
  - Improve error handling for deep link timeouts and early tab closures.

- Observability & Safety
  - Add structured telemetry for transport state (without sensitive data).
  - Prompt for user confirmation before using non‑default derivation paths.

## Developer Notes

- Build & Run
  - `cd mobile && npm ci`
  - Android: `npx react-native run-android`
  - Ensure Chrome is installed/enabled and handles supported links.

- Testing
  - `npm test -- --ci --reporters=default --watchAll=false`
  - Jest mocks handle native modules and keep tests fast.

- Where to Look in Source
  - `mobile/App.tsx`: Core UI, logging, CCT flow, handler HTML.
  - `mobile/android/app/src/main/java/app/sifar/customtabs`: Partial Custom Tabs module.
  - `mobile/android/app/src/main/AndroidManifest.xml`: Deep link intent filter.
  - `mobile/jest.setup.js`: Mocks for webview, static server, fs, inappbrowser.

---

This document is meant to keep the team aligned on the current approach and why we made these choices. If constraints change (e.g., allow external hosting or different transports), we can revisit the design.

