import { encodeFrame, decodeFrames } from '../src/services/hardware/trezor/wire';

test('encode/decode temporary framing round-trips', () => {
  const msgType = 1234;
  const payload = new Uint8Array([1,2,3,4,5,6,7,8,9,10]);
  const frames = encodeFrame(msgType, payload);
  const { msgType: t, payload: p } = decodeFrames(frames);
  expect(t).toBe(msgType);
  expect(Array.from(p)).toEqual(Array.from(payload));
});

