import { LedgerBridge } from './LedgerBridge';

describe('LedgerBridge (no Ledger libs present)', () => {
  test('initialize does not throw', async () => {
    const bridge = new LedgerBridge();
    await expect(bridge.initialize()).resolves.toBeUndefined();
  });

  test('scanForDevices returns empty array when transport missing', async () => {
    const bridge = new LedgerBridge();
    const devices = await bridge.scanForDevices();
    expect(Array.isArray(devices)).toBe(true);
  });
});

