import { encodeSolanaGetPublicKey, decodeSolanaPublicKey, bip32Path } from '../src/services/hardware/trezor/proto';

test('encodeSolanaGetPublicKey produces bytes', () => {
  const path = bip32Path("m/44'/501'/0'");
  const buf = encodeSolanaGetPublicKey(path, false);
  expect(buf.byteLength).toBeGreaterThan(0);
});

test('decodeSolanaPublicKey reads bytes', () => {
  // Create a fake SolanaPublicKey message using the same encoder path where available
  // This test relies on fallback inline proto if descriptor is missing.
  const pk = new Uint8Array([11,22,33,44]);
  // Inline-encode by reusing encode via dynamic message (not exposed) – alternatively simulate a simple wrap
  // We simulate decode path by reconstructing a minimal protobuf: field 1 (bytes) with pk
  const fieldTag = 1 << 3 | 2; // field 1, wire type 2 (length-delimited)
  const len = pk.length;
  const msg = new Uint8Array(2 + len);
  msg[0] = fieldTag;
  msg[1] = len;
  msg.set(pk, 2);
  const out = decodeSolanaPublicKey(msg);
  expect(Array.from(out.public_key)).toEqual(Array.from(pk));
});

