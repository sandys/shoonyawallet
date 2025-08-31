import { TrezorBridge } from '../src/services/hardware/TrezorBridge';

const connectMock: any = {
  init: jest.fn().mockResolvedValue(undefined),
  on: jest.fn(),
  solanaGetPublicKey: jest.fn().mockResolvedValue({ success: true, payload: { publicKey: 'FAKEPUBKEY1234567890' } }),
  getFeatures: jest.fn().mockResolvedValue({ success: true }),
};

jest.mock('@trezor/connect', () => ({ __esModule: true, default: connectMock }));

describe('TrezorBridge', () => {
  it('returns a public key via Trezor Connect', async () => {
    const logs: string[] = [];
    const bridge = new TrezorBridge((m) => logs.push(m));
    const key = await bridge.connectAndGetPublicKey({ maxAttempts: 2 });
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(16);
    expect(logs.length).toBeGreaterThan(0);
  });

  it('does not retry on permission denied', async () => {
    connectMock.solanaGetPublicKey.mockResolvedValueOnce({ success: false, payload: { error: 'Permission not granted' } });
    const bridge = new TrezorBridge();
    await expect(bridge.connectAndGetPublicKey({ maxAttempts: 3 })).rejects.toThrow(/Permission/i);
  });

  it('retries on busy then succeeds', async () => {
    connectMock.solanaGetPublicKey
      .mockResolvedValueOnce({ success: false, payload: { error: 'Device busy' } })
      .mockResolvedValueOnce({ success: true, payload: { publicKey: 'AFTERRETRYKEY' } });
    const bridge = new TrezorBridge();
    const key = await bridge.connectAndGetPublicKey({ maxAttempts: 3, attemptDelayMs: 1 });
    expect(key).toBe('AFTERRETRYKEY');
  });

  it('retries on transport timeout', async () => {
    connectMock.solanaGetPublicKey
      .mockResolvedValueOnce({ success: false, payload: { error: 'USB transport timeout' } })
      .mockResolvedValueOnce({ success: true, payload: { publicKey: 'OK' } });
    const bridge = new TrezorBridge();
    const key = await bridge.connectAndGetPublicKey({ maxAttempts: 2, attemptDelayMs: 1 });
    expect(key).toBe('OK');
  });
});
