# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a React Native mobile application that acts as a WalletConnect v2-compliant bridge between Jupiter DEX and hardware wallets (Trezor/Ledger). The app enables secure transaction signing on hardware wallets while interacting with DeFi protocols on mobile browsers.

**Security Model**: The app is designed to be "provably dumb" - it cannot access private keys, modify transactions, or act maliciously. All security-critical operations are offloaded to hardware wallets.

## Development Commands

All commands should be run from the `mobile/` directory:

```bash
# Install dependencies
npm ci

# iOS setup (first run only)
cd ios && bundle install && bundle exec pod install && cd ..

# Development
npm start                    # Start Metro bundler
npm run android             # Run on Android
npm run ios                 # Run on iOS

# Code Quality
npm run lint                # ESLint
npm test                    # Jest tests
npm run gen:trezor-descriptor  # Generate Trezor protobuf descriptor

# Production builds
cd android && ./gradlew assembleRelease  # Android release build
```

## Architecture

The codebase follows the structure outlined in `spec.md` section 9.1:

### Key Services
- **Hardware Bridges** (`src/services/hardware/`):
  - `TrezorBridge.ts` - USB-C connection for Android only
  - `LedgerBridge.ts` - Bluetooth connection for iOS/Android
  - Both implement secure signing with passphrase support

- **RPC Service** (`src/services/rpc/`):
  - `SolanaRPCService.ts` - Handles read-only blockchain queries
  - `rpcConfig.ts` - RPC endpoint rotation logic

- **Protocol Integration**:
  - Trezor uses custom protobuf implementation in `src/services/hardware/trezor/`
  - Ledger uses `@ledgerhq` libraries with Bluetooth transport

### Project Structure
```
mobile/src/
├── services/hardware/     # Hardware wallet integrations
├── services/rpc/         # Solana blockchain queries  
├── config/               # RPC endpoints configuration
└── native/               # Native USB module for Trezor
```

## Testing

- Uses Jest with React Native preset
- Test files: `**/__tests__/*.test.ts` or `*.test.ts` alongside source
- Hardware wallet interactions are mocked in tests
- Run `npm test` for full test suite

## Security Requirements

**Critical**: This is a security-focused application. Always:
1. Never store private keys or seed phrases
2. Never modify transactions (pass-through only)
3. Validate chain before hardware signing to prevent cross-chain attacks
4. Show verification links before signing
5. Fail closed when uncertain

See `spec.md` sections 5-7 for detailed security requirements and attack vector prevention.

## Platform Support

- **Android**: Supports both Trezor (USB-C) and Ledger (Bluetooth)
- **iOS**: Ledger only via Bluetooth (no USB support)
- **Minimum**: iOS 13+, Android 8.0+ (API 26+)

## Dependencies

Key libraries:
- `@trezor/*` packages for Trezor integration
- `@ledgerhq/*` packages for Ledger integration  
- `@solana/web3.js` for Solana blockchain interaction
- `bs58` for address encoding
- `protobufjs` for Trezor protocol

## Current Implementation Status

The codebase currently implements:
- Trezor USB bridge with passphrase support
- Ledger Bluetooth bridge  
- Solana RPC service for blockchain queries
- Basic test infrastructure

Still needed for full WalletConnect implementation:
- WalletConnect v2 provider service
- Transaction verification screens
- Session management
- Chain validation

## CLI Efficiency Guidelines

**Core Principle**: One CLI command > Multiple tool calls

**Essential Commands**:

1. **Pattern Search**:
   - `rg -n "pattern" --glob '!node_modules/*'` instead of multiple Grep calls
2. **File Finding**:
   - `fd filename` or `fd .ext directory` instead of Glob tool
3. **File Preview**:
   - `bat -n filepath` for syntax-highlighted preview with line numbers
4. **Bulk Refactoring**:
   - `rg -l "pattern" | xargs sed -i 's/old/new/g'` for mass replacements
5. **Project Structure**:
   - `tree -L 2 directories` for quick overview
6. **JSON Inspection**:
   - `jq '.key' file.json` for quick JSON parsing

**The Game-Changing Pattern**:
```bash
# Find files → Pipe to xargs → Apply sed transformation
rg -l "find_this" | xargs sed -i 's/replace_this/with_this/g'
```
This single pattern can replace dozens of Edit tool calls!

**Mental Note**: Before reaching for Read/Edit/Glob tools, ask:
- Can `rg` find this pattern faster?
- Can `fd` locate these files quicker?  
- Can `sed` fix all instances at once?
- Can `jq` extract this JSON data directly?

Prioritize CLI power tools for faster code discovery, bulk refactoring, efficient file operations, and better performance overall.