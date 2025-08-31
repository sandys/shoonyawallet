# Repository Guidelines

## Project Structure & Module Organization
- Current files: `spec.md` (authoritative blueprint). Implement code under `src/` following the structure in spec section 9.1, e.g. `src/services/walletconnect/WalletConnectProvider.ts`, `src/services/hardware/LedgerBridge.ts`, `src/screens/VerificationScreen.tsx`.
- Tests live alongside code as `*.test.ts(x)` or under `src/**/__tests__/`.
- Assets (icons, images) go in `assets/`; native configs in `ios/` and `android/`.

## Build, Test, and Development Commands
- Install deps: `npm ci` (or `yarn install`).
- iOS (first run): `cd ios && pod install && cd ..`; run: `npx react-native run-ios`.
- Android: `npx react-native run-android`.
- Lint/format: `npm run lint` / `npm run format` (ESLint + Prettier).
- Type-check: `npm run typecheck` (TS).
- Tests: `npm test` or `npm test -- --coverage`.
- Android release: `cd android && ./gradlew assembleRelease`.

## Coding Style & Naming Conventions
- Language: TypeScript throughout (`.ts/.tsx`); 2-space indentation.
- Files: services/components `PascalCase` (e.g., `VerificationService.ts`), hooks `camelCase` prefixed with `use` (e.g., `useLedger.ts`).
- Identifiers: functions/vars `camelCase`, types/interfaces `PascalCase`, constants `UPPER_SNAKE_CASE`.
- React: function components; keep components pure; co-locate styles and tests.
- Tools: ESLint (`@typescript-eslint`) and Prettier; fix on save preferred.

## Testing Guidelines
- Frameworks: Jest + `@testing-library/react-native` for UI; mock hardware/RPC.
- Names: `*.test.ts`/`*.test.tsx`; mirror source path.
- Coverage: aim ≥80% for `src/services/**`; prioritize spec section 10 critical cases (chain confusion, malformed tx, session, BLE disconnect, backgrounding).
- Run full suite locally before PRs: `npm test -- --coverage`.

## Commit & Pull Request Guidelines
- Commits follow Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:`.
- PRs must include: concise description, linked issue, screenshots for UI screens, platform notes (iOS/Android), and a security checklist affirming: no private key storage, no tx modification, hardware-only signing, chain validation present.
- Keep PRs small and focused; add migration notes if native changes.

## Security & Configuration Tips
- Never store seeds/keys; reject on uncertainty; lazy-load hardware libs; validate active chain and show verification links (see spec sections 5–7).
- Permissions/config: ensure Android `android.hardware.usb.host`, BLE permissions, and iOS Bluetooth Info.plist entries match the spec.
