// Ensure React Native platform and TurboModules are mocked for Jest env

// Mock DevMenu TurboModule to avoid getEnforcing('DevMenu') crash
jest.mock('react-native/src/private/devsupport/devmenu/specs/NativeDevMenu', () => ({
  __esModule: true,
  default: {},
}));

// Mock Clipboard TurboModule globally for tests that import it
jest.mock('@react-native-clipboard/clipboard', () => ({
  __esModule: true,
  default: { setString: jest.fn(), getString: jest.fn().mockResolvedValue('') },
}));

// Do not mock the entire react-native module to avoid TurboModule lookups.
// TrezorBridge skips iOS-only guards under Jest via JEST_WORKER_ID.
