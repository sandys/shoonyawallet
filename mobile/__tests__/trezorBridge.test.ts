jest.mock('react-native', () => ({
  ...jest.requireActual('react-native'),
  Platform: { ...jest.requireActual('react-native').Platform, OS: 'android' },
}));

// Mock native USB similar to bridge_exchange
jest.mock('../src/native/TrezorUSB', () => {
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
          if (readQueue.length === 0) {
            const featuresFrames = wire.encodeFrame(1000, new Uint8Array([]));
            readQueue.push(Array.from(featuresFrames[0]));
          } else {
            const payload = new Uint8Array([ (1<<3)|2, 4, 0xde, 0xad, 0xbe, 0xef ]);
            const frames = wire.encodeFrame(999, payload);
            readQueue.push(...frames.map(f => Array.from(f)));
          }
          return [];
        }
        return readQueue.shift() || [];
      },
      async close() { return; },
    }
  };
});

import { TrezorBridge } from '../src/services/hardware/TrezorBridge';

describe('TrezorBridge', () => {
  it('returns a public key via mocked USB exchange', async () => {
    const logs: string[] = [];
    const bridge = new TrezorBridge((m) => logs.push(m));
    const key = await bridge.connectAndGetPublicKey({ maxAttempts: 2 });
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(16);
    expect(logs.length).toBeGreaterThan(0);
  });
});
