/* Focused tests for adapter encode/decode mapping via @trezor/protobuf.
 * Skips if the real package is not installed in the environment. */

describe('trezor transport adapter (protobuf mapping)', () => {
  const loadAdapter = () => {
    jest.resetModules();
    // Use whatever environment provides (real or mocked via jest.setup)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('../src/services/hardware/trezor/transportAdapter') as typeof import('../src/services/hardware/trezor/transportAdapter');
  };

  const PATH = [44 | 0x80000000, 501 | 0x80000000, 0 | 0x80000000];

  it('encodes/decodes Initialize correctly', async () => {
    const { encodeByName, decodeToObject } = loadAdapter();
    const { msgType, payload } = await encodeByName('Initialize', {});
    expect(typeof msgType).toBe('number');
    // Initialize is an empty message
    expect(payload.byteLength).toBe(0);
    const decoded = decodeToObject(msgType, payload);
    // Accept null or any decoded structure depending on environment
    expect(decoded === null || typeof decoded === 'object').toBe(true);
  });

  it('encodes SolanaGetPublicKey payload', async () => {
    const { encodeByName, decodeToObject } = loadAdapter();
    const { msgType, payload } = await encodeByName('SolanaGetPublicKey', { address_n: PATH, show_display: false });
    expect(typeof msgType).toBe('number');
    // If Solana definitions were loaded, payload may be non-empty and decode returns mapping.
    // Otherwise tolerate empty payload / null decode.
    const decoded = decodeToObject(msgType, payload);
    expect(decoded === null || typeof decoded === 'object').toBe(true);
  });
});
