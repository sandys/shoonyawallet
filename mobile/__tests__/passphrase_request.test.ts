import { TrezorBridge } from '../src/services/hardware/TrezorBridge';

// Mock native USB to simulate PassphraseRequest (0x0029), followed by successful pubkey
jest.mock('../src/native/TrezorUSB', () => {
  let readQueue: number[][] = [];
  // Simple state machine
  let phase: 'init' | 'pkRequested' | 'awaitAck' | 'done' = 'init';
  return {
    TrezorUSB: {
      isSupported: () => true,
      async list() { return [{ vendorId: 0x1209, productId: 0x53C1, deviceName: 'Trezor' }]; },
      async ensurePermission() { return; },
      async open() { return; },
      async getInterfaceInfo() { return { interfaceClass: 0x03 }; },
      async exchange(bytes: number[], _timeout: number) {
        if (bytes.length > 0) {
          if (phase === 'init') {
            // Mock Features response - create raw protobuf message
            const protocol = jest.requireActual('@trezor/protocol');
            const { Buffer } = jest.requireActual('buffer');
            
            // Create minimal Features message (type 17) with empty payload
            const featuresPayload = Buffer.alloc(0);
            const encoded = protocol.v1.encode(featuresPayload, { messageType: 17 });
            readQueue.push(Array.from(encoded.slice(0, 64)));
            phase = 'pkRequested';
          } else if (phase === 'pkRequested') {
            // Mock PassphraseRequest (type 41) with empty payload  
            const protocol = jest.requireActual('@trezor/protocol');
            const { Buffer } = jest.requireActual('buffer');
            
            const passReqPayload = Buffer.alloc(0);
            const encoded = protocol.v1.encode(passReqPayload, { messageType: 41 });
            readQueue.push(Array.from(encoded.slice(0, 64)));
            phase = 'awaitAck';
          } else if (phase === 'awaitAck') {
            // Mock SolanaPublicKey response with fake pubkey
            const protocol = jest.requireActual('@trezor/protocol');
            const { Buffer } = jest.requireActual('buffer');
            
            const pk = new Uint8Array(Array.from({ length: 32 }, (_, i) => (i * 5) & 0xff));
            const payload = Buffer.alloc(2 + pk.length);
            payload[0] = (1 << 3) | 2; // field 1, length-delimited
            payload[1] = pk.length;
            pk.copy(payload, 2);
            
            // Use a fake message type that will be handled as unknown
            const encoded = protocol.v1.encode(payload, { messageType: 999 });
            readQueue.push(Array.from(encoded.slice(0, 64)));
            phase = 'done';
          }
          return [];
        }
        return readQueue.shift() || [];
      },
      async close() { return; },
      async getDebugLog() { return []; },
    }
  };
});

test.skip('handles PassphraseRequest by prompting and proceeds to pubkey', async () => {
  const logs: string[] = [];
  const passphrases: string[] = [];
  const bridge = new TrezorBridge((m) => logs.push(m), async () => {
    passphrases.push('hunter2');
    return 'hunter2';
  });
  const key = await bridge.connectAndGetPublicKey({ maxAttempts: 1, attemptDelayMs: 1 });
  expect(typeof key).toBe('string');
  expect(passphrases.length).toBe(1); // prompted exactly once
  expect(logs.some((l) => /Passphrase requested/.test(l))).toBe(true);
});

