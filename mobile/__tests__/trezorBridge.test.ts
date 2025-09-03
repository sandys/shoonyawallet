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
      async getInterfaceInfo() { return { interfaceClass: 255 }; },
      async exchange(bytes: number[], _timeout: number) {
        if (bytes.length > 0) {
          if (requestCount === 0) {
            // Mock Features response using official protocol
            const protocol = jest.requireActual('@trezor/protocol');
            const { encodeMessage, Messages, parseConfigure } = jest.requireActual('@trezor/protobuf');
            const messages = parseConfigure(Messages);
            const { Buffer } = jest.requireActual('buffer');
            
            const { messageType, message } = encodeMessage(messages, 'Features', {
              vendor: 'SatoshiLabs',
              device_id: 'test123',
              major_version: 2,
              minor_version: 0,
              patch_version: 0
            });
            const encoded = protocol.v1.encode(message, { messageType });
            readQueue.push(Array.from(encoded.slice(0, 64)));
            if (encoded.length > 64) {
              for (let i = 64; i < encoded.length; i += 64) {
                readQueue.push(Array.from(encoded.slice(i, i + 64)));
              }
            }
            requestCount += 1;
          } else {
            // Mock SolanaPublicKey response
            const protocol = jest.requireActual('@trezor/protocol');
            const { encodeMessage, Messages, parseConfigure } = jest.requireActual('@trezor/protobuf');
            const messages = parseConfigure(Messages);
            
            const pk = new Uint8Array(Array.from({ length: 32 }, (_, i) => (i * 7) & 0xff));
            const { messageType, message } = encodeMessage(messages, 'SolanaPublicKey', {
              public_key: pk
            });
            const encoded = protocol.v1.encode(message, { messageType });
            readQueue.push(Array.from(encoded.slice(0, 64)));
            if (encoded.length > 64) {
              for (let i = 64; i < encoded.length; i += 64) {
                readQueue.push(Array.from(encoded.slice(i, i + 64)));
              }
            }
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
  it.skip('returns a public key via mocked USB exchange', async () => {
    const logs: string[] = [];
    const bridge = new TrezorBridge((m) => logs.push(m));
    const key = await bridge.connectAndGetPublicKey({ maxAttempts: 2 });
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(16);
    expect(logs.length).toBeGreaterThan(0);
  });
});
