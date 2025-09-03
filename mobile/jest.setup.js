/* eslint-disable no-undef, no-bitwise */
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
      getParsedTokenAccountsByOwner: jest.fn().mockResolvedValue({ value: [] }),
    }));
    const PublicKey = jest.fn();
    return { __esModule: true, Connection, PublicKey };
  },
  { virtual: true },
);

// Mock bs58 for tests since it's not in node_modules yet
jest.mock(
  'bs58',
  () => ({
    __esModule: true,
    default: {
      encode: jest.fn((buf) => 'mock_base58_encoded_string'),
      decode: jest.fn((str) => new Uint8Array([1, 2, 3, 4])),
    },
  }),
  { virtual: true },
);

// Mock @trezor/protobuf for tests since it's not in node_modules yet
jest.mock(
  '@trezor/protobuf',
  () => ({
    __esModule: true,
    Messages: {},
    parseConfigure: jest.fn(() => ({})),
    encodeMessage: jest.fn((messages, name, data) => {
      // Mock message encoding - return reasonable message types for tests
      const messageTypes = {
        'Initialize': 0,
        'SolanaGetPublicKey': 900,
      };
      return { 
        messageType: messageTypes[name] || 0,
        message: name === 'Initialize' ? Buffer.alloc(0) : Buffer.from([0x08, 0x01]) // Initialize should be empty
      };
    }),
    decodeMessage: jest.fn((messages, msgType, payload) => {
      const types = {
        17: 'Features',
        901: 'SolanaPublicKey',
      };
      return { 
        type: types[msgType] || 'Unknown',
        message: { public_key: Buffer.from([1, 2, 3, 4]) }
      };
    }),
    loadDefinitions: jest.fn(() => ({})),
  }),
  { virtual: true },
);

// Mock @trezor/protocol for tests since it's not in node_modules yet
jest.mock(
  '@trezor/protocol',
  () => ({
    __esModule: true,
    v1: {
      encode: jest.fn((payload, options) => {
        // Mock v1 protocol encoding - returns a Buffer-like with the message type and payload
        const msgType = options?.messageType || 0;
        const header = Buffer.from([0x3f, 0x23, 0x23, (msgType >> 8) & 0xff, msgType & 0xff, 0, 0, 0, payload.length]);
        return Buffer.concat([header, Buffer.from(payload)]);
      }),
      decode: jest.fn((buffer) => {
        // Mock v1 protocol decoding
        const buf = Buffer.from(buffer);
        if (buf.length >= 9 && buf[0] === 0x3f && buf[1] === 0x23 && buf[2] === 0x23) {
          const messageType = (buf[3] << 8) | buf[4];
          const length = (buf[5] << 24) | (buf[6] << 16) | (buf[7] << 8) | buf[8];
          const payload = buf.slice(9, 9 + length);
          return { messageType, length, payload };
        }
        return { messageType: 0, length: 0, payload: Buffer.alloc(0) };
      }),
    },
  }),
  { virtual: true },
);
