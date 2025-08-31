// Mock native USB similar to bridge_exchange
jest.mock('../src/native/TrezorUSB', () => {
  let readQueue: number[][] = [];
  let requestCount = 0;
  return {
    TrezorUSB: {
      isSupported: () => true,
      async list() { return [{ vendorId: 0x1209, productId: 0x53C1, deviceName: 'Trezor' }]; },
      async ensurePermission() { return; },
      async open() { return; },
      async exchange(bytes: number[], _timeout: number) {
        const wire = jest.requireActual('../src/services/hardware/trezor/wire');
        if (bytes.length > 0) {
          if (requestCount === 0) {
            const featuresFrames = wire.encodeFrame(1000, new Uint8Array([]));
            readQueue.push(Array.from(featuresFrames[0]));
            requestCount += 1;
          } else {
            const pk = new Uint8Array(Array.from({ length: 32 }, (_, i) => (i * 7) & 0xff));
            const payload = new Uint8Array(2 + pk.length);
            payload[0] = (1 << 3) | 2; // field 1, length-delimited
            payload[1] = pk.length; // 32
            payload.set(pk, 2);
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
