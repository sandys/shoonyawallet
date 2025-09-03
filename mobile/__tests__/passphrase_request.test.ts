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
        const wire = jest.requireActual('../src/services/hardware/trezor/wire');
        // Any write indicates a request frame was sent
        if (bytes.length > 0) {
          if (phase === 'init') {
            // Respond to Initialize with Features (fake type 1000)
            const features = new Uint8Array([]);
            const frames = wire.encodeFrame(1000, features);
            readQueue.push(...frames.map(f => Array.from(f)));
            phase = 'pkRequested';
          } else if (phase === 'pkRequested') {
            // First Solana GetPublicKey → reply with PassphraseRequest (0x0029 = 41)
            const passReq = new Uint8Array([]);
            const frames = wire.encodeFrame(41, passReq);
            readQueue.push(...frames.map(f => Array.from(f)));
            phase = 'awaitAck';
          } else if (phase === 'awaitAck') {
            // Host sends PassphraseAck (0x002A = 42). After that, send the pubkey.
            const pk = new Uint8Array(Array.from({ length: 32 }, (_, i) => (i * 5) & 0xff));
            const payload = new Uint8Array(2 + pk.length);
            payload[0] = (1 << 3) | 2; // field 1, length-delimited
            payload[1] = pk.length;
            payload.set(pk, 2);
            const frames = wire.encodeFrame(999 /* fake SolanaPublicKey */, payload);
            readQueue.push(...frames.map(f => Array.from(f)));
            phase = 'done';
          }
          return [];
        }
        // Read side: pop next queued frame
        return readQueue.shift() || [];
      },
      async close() { return; },
      async getDebugLog() { return []; },
    }
  };
});

test('handles PassphraseRequest by prompting and proceeds to pubkey', async () => {
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

