import { bip32Path } from '../src/services/hardware/trezor/proto';

test('bip32Path parses hardened segments', () => {
  const path = bip32Path("m/44'/501'/0'");
  expect(path.length).toBe(3);
  // Check hardened bit set
  for (const v of path) {
    expect(v >>> 0).toBe(v);
    expect((v & 0x80000000) >>> 0).toBe(0x80000000);
  }
});

