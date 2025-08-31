import { TrezorBridge } from '../src/services/hardware/TrezorBridge';

describe('TrezorBridge', () => {
  it('retries and returns a public key on Android (simulated)', async () => {
    const logs: string[] = [];
    const bridge = new TrezorBridge((m) => logs.push(m));
    const key = await bridge.connectAndGetPublicKey({ maxAttempts: 2 });
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(30);
    expect(logs.length).toBeGreaterThan(0);
  });
});
