// Trezor HID wire framing (skeleton). Keep logic in JS per project guidance.
// NOTE: This is a placeholder; finalize framing fields before production.

export const REPORT_SIZE = 64;
const HDR_FIRST = new Uint8Array([0x3f, 0x23, 0x23]); // '?##' first-frame
const HDR_NEXT = new Uint8Array([0x3f, 0x2b, 0x2b]);  // '?++' continuation

type Header = { msgType: number; payloadLen: number; headerLen: number; format: 'A' | 'B' };

export function chunk(data: Uint8Array, size = REPORT_SIZE): Uint8Array[] {
  const out: Uint8Array[] = [];
  for (let i = 0; i < data.length; i += size) {
    const slice = data.subarray(i, Math.min(i + size, data.length));
    if (slice.length === size) out.push(slice);
    else {
      const pad = new Uint8Array(size);
      pad.set(slice);
      out.push(pad);
    }
  }
  if (out.length === 0) out.push(new Uint8Array(size));
  return out;
}

export function concat(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// Frame encoding/decoding to be filled with Trezor specifics.
// Temporary framing: [0x3f, 0x23, type_lo, type_hi, len0..len3, ...payload]
// This is NOT the official Trezor HID framing and must be replaced with
// correct framing. It exists to allow unit tests and end-to-end plumbing.
export function encodeFrame(msgType: number, payload: Uint8Array): Uint8Array[] {
  // Official-style Trezor HID framing (first + continuation frames)
  const len = payload.length >>> 0;
  const firstHeader = new Uint8Array(3 + 2 + 4); // '?##' + type BE16 + len BE32
  firstHeader.set(HDR_FIRST, 0);
  firstHeader[3] = (msgType >>> 8) & 0xff;
  firstHeader[4] = msgType & 0xff;
  firstHeader[5] = (len >>> 24) & 0xff;
  firstHeader[6] = (len >>> 16) & 0xff;
  firstHeader[7] = (len >>> 8) & 0xff;
  firstHeader[8] = len & 0xff;

  const firstAvail = REPORT_SIZE - firstHeader.length;
  const out: Uint8Array[] = [];
  const firstChunk = payload.subarray(0, Math.min(firstAvail, payload.length));
  const firstFrame = new Uint8Array(firstHeader.length + firstChunk.length);
  firstFrame.set(firstHeader, 0);
  firstFrame.set(firstChunk, firstHeader.length);
  // Pad to REPORT_SIZE
  out.push(padToReport(firstFrame));

  let offset = firstChunk.length;
  let seq = 0;
  while (offset < payload.length) {
    const contHeader = new Uint8Array(3 + 2); // '?++' + seq BE16
    contHeader.set(HDR_NEXT, 0);
    contHeader[3] = (seq >>> 8) & 0xff;
    contHeader[4] = seq & 0xff;
    seq++;
    const avail = REPORT_SIZE - contHeader.length;
    const chunkData = payload.subarray(offset, Math.min(offset + avail, payload.length));
    const frame = new Uint8Array(contHeader.length + chunkData.length);
    frame.set(contHeader, 0);
    frame.set(chunkData, contHeader.length);
    out.push(padToReport(frame));
    offset += chunkData.length;
  }
  return out;
}

function tryParseHeader(buf: Uint8Array): Header | null {
  // First frame: '?##' + type BE16 + len BE32
  if (buf.length >= 9 && buf[0] === HDR_FIRST[0] && buf[1] === HDR_FIRST[1] && buf[2] === HDR_FIRST[2]) {
    const type = (buf[3] << 8) | buf[4];
    const len = (buf[5] << 24) | (buf[6] << 16) | (buf[7] << 8) | buf[8];
    return { msgType: type >>> 0, payloadLen: len >>> 0, headerLen: 9, format: 'B' };
  }
  // Legacy candidate: 0x3f 0x23 + type LE16 + len LE32
  if (buf.length >= 8 && buf[0] === 0x3f && buf[1] === 0x23) {
    const type = buf[2] | (buf[3] << 8);
    const len = buf[4] | (buf[5] << 8) | (buf[6] << 16) | (buf[7] << 24);
    return { msgType: type >>> 0, payloadLen: len >>> 0, headerLen: 8, format: 'A' };
  }
  return null;
}

export function decodeFrames(frames: Uint8Array[]): { msgType: number; payload: Uint8Array } {
  const buf = concat(frames);
  const h = tryParseHeader(buf);
  if (!h) return { msgType: 0, payload: buf };
  const payload = buf.subarray(h.headerLen, h.headerLen + h.payloadLen);
  return { msgType: h.msgType, payload };
}

export async function sendAndReceive(
  exchange: (bytes: number[], timeout: number) => Promise<number[]>,
  msgType: number,
  payload: Uint8Array,
  timeoutMs = 2000,
): Promise<{ msgType: number; payload: Uint8Array }> {
  const frames = encodeFrame(msgType, payload);
  // Send all frames
  for (const f of frames) {
    await exchange(Array.from(f), timeoutMs);
  }
  // Read until full payload assembled
  const received: Uint8Array[] = [];
  let header: Header | null = null;
  let totalPayload = 0;
  const maxFrames = 256;
  for (let i = 0; i < maxFrames; i++) {
    const part = await exchange([], timeoutMs);
    const u8 = new Uint8Array(part);
    received.push(u8);
    const merged = concat(received);
    header = header || tryParseHeader(merged);
    if (header) {
      const available = Math.max(0, merged.length - header.headerLen);
      totalPayload = available;
      if (available >= header.payloadLen) break;
    }
  }
  if (!header) return { msgType: 0, payload: concat(received) };
  const full = concat(received);
  const payloadBuf = full.subarray(header.headerLen, header.headerLen + header.payloadLen);
  return { msgType: header.msgType, payload: payloadBuf };
}

function padToReport(frame: Uint8Array): Uint8Array {
  if (frame.length === REPORT_SIZE) return frame;
  const out = new Uint8Array(REPORT_SIZE);
  out.set(frame, 0);
  return out;
}
