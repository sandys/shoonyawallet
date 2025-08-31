/* Focused tests for adapter encode/decode mapping via @trezor/protobuf.
 * Skips if the real package is not installed in the environment. */

describe('trezor transport adapter (protobuf mapping)', () => {
  const hasRealProtobuf = (() => {
    try { require.resolve('@trezor/protobuf'); return true; } catch { return false; }
  })();

  const loadAdapter = () => {
    jest.resetModules();
    // Ensure we use the real protobuf implementation (not the jest.setup mock)
    jest.unmock('@trezor/protobuf');
    // Now require adapter, which will import the real @trezor/protobuf
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('../src/services/hardware/trezor/transportAdapter') as typeof import('../src/services/hardware/trezor/transportAdapter');
  };

  const PATH = [44 | 0x80000000, 501 | 0x80000000, 0 | 0x80000000];

  (hasRealProtobuf ? it : it.skip)('encodes/decodes Initialize correctly', () => {
    const { encodeByName, decodeToObject } = loadAdapter();
    const { msgType, payload } = encodeByName('Initialize', {});
    expect(typeof msgType).toBe('number');
    // Initialize is an empty message
    expect(payload.byteLength).toBe(0);
    const decoded = decodeToObject(msgType, payload);
    expect(decoded).toBeTruthy();
    expect((decoded!.type || '').toLowerCase()).toContain('initialize');
  });

  (hasRealProtobuf ? it : it.skip)('encodes SolanaGetPublicKey payload', () => {
    const { encodeByName, decodeToObject } = loadAdapter();
    const { msgType, payload } = encodeByName('SolanaGetPublicKey', { address_n: PATH, show_display: false });
    expect(typeof msgType).toBe('number');
    expect(payload.byteLength).toBeGreaterThan(0);
    const decoded = decodeToObject(msgType, payload);
    expect(decoded).toBeTruthy();
    expect((decoded!.type || '').toLowerCase()).toContain('solanagetpublickey');
  });
});

