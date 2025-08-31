import { TrezorBridge } from '../src/services/hardware/TrezorBridge';
// Ensure Platform is Android for this test environment
jest.mock('react-native', () => ({
  ...jest.requireActual('react-native'),
  Platform: { ...jest.requireActual('react-native').Platform, OS: 'android' },
}));
// (no direct imports of wire/proto to satisfy jest.mock scoping)

// Mock native USB module
jest.mock('../src/native/TrezorUSB', () => {
  // Stateful mock to simulate handshake and multi-frame response
  let readQueue: number[][] = [];
  return {
    TrezorUSB: {
      isSupported: () => true,
      async list() { return [{ vendorId: 0x1209, productId: 0x53C1, deviceName: 'Trezor' }]; },
      async ensurePermission() { return; },
      async open() { return; },
      async exchange(bytes: number[], _timeout: number) {
        const wire = jest.requireActual('../src/services/hardware/trezor/wire');
        if (bytes.length > 0) {
          // If request sent, enqueue a proper framed response
          // First call will be Initialize → Features
          // Enqueue a single-frame Features (empty payload acceptable for test)
          if (readQueue.length === 0) {
            const features = new Uint8Array([]);
            const featuresFrames = wire.encodeFrame(1000 /* fake Features type */, features);
            readQueue.push(Array.from(featuresFrames[0]));
          } else {
            // Subsequent call: return SolanaPublicKey with 4-byte key
            const payload = new Uint8Array([ (1<<3)|2, 4, 0xde, 0xad, 0xbe, 0xef ]);
            const frames = wire.encodeFrame(999 /* fake SolanaPublicKey type */, payload);
            readQueue.push(...frames.map(f => Array.from(f)));
          }
          return [];
        }
        // Read side: pop next frame
        return readQueue.shift() || [];
      },
      async close() { return; },
    }
  };
});

test('bridge attempts to get public key over USB', async () => {
  const logs: string[] = [];
  const b = new TrezorBridge((m) => logs.push(m));
  await expect(b.connectAndGetPublicKey({ maxAttempts: 1, attemptDelayMs: 1 })).resolves.toBeDefined();
  expect(logs.some((l) => /Opening USB session/.test(l))).toBe(true);
});
