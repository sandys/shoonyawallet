// Ensure React Native platform and TurboModules are mocked for Jest env

// Mock DevMenu TurboModule to avoid getEnforcing('DevMenu') crash
jest.mock(
  'react-native/src/private/devsupport/devmenu/specs/NativeDevMenu',
  () => ({
    __esModule: true,
    default: {},
  }),
  { virtual: true },
);

// Mock Clipboard TurboModule globally for tests that import it
jest.mock(
  '@react-native-clipboard/clipboard',
  () => ({
    __esModule: true,
    default: { setString: jest.fn(), getString: jest.fn().mockResolvedValue('') },
  }),
  { virtual: true },
);

// Do not mock the entire react-native module to avoid TurboModule lookups.
// TrezorBridge skips iOS-only guards under Jest via JEST_WORKER_ID.

// Mock @solana/web3.js to avoid pulling the heavy dependency in tests
jest.mock(
  '@solana/web3.js',
  () => {
    const Connection = jest.fn().mockImplementation(() => ({
      getBalance: jest.fn().mockResolvedValue(0),
    }));
    const PublicKey = jest.fn();
    return { __esModule: true, Connection, PublicKey };
  },
  { virtual: true },
);

// Conditionally mock @trezor/protobuf only if not installed (local dev env)
try {
  require.resolve('@trezor/protobuf');
} catch {
  jest.mock(
    '@trezor/protobuf',
    () => ({
      __esModule: true,
      parseConfigure: (m) => m,
      Messages: {},
      encodeMessage: (_messages, _name, _data) => ({ messageType: 0, message: Buffer.from([]) }),
      decodeMessage: (_messages, _type, _data) => ({ type: 'Unknown', message: {} }),
    }),
    { virtual: true },
  );
}
