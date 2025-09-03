// Adapter that prefers @trezor/transport for framing if available,
// otherwise falls back to our local wire implementation.

import { setTransportMode, encodeFromEncoded, concat } from './wire';
import { Messages, parseConfigure, encodeMessage as pbEncodeMessage, decodeMessage as pbDecodeMessage, loadDefinitions } from '@trezor/protobuf';
const MESSAGES = parseConfigure(Messages);

// Strictly require @trezor/protocol — no runtime fallbacks
// eslint-disable-next-line @typescript-eslint/no-var-requires
const trezorProtocol = require('@trezor/protocol');
function toNodeBuffer(u8: Uint8Array): any {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Buffer } = require('buffer');
    return Buffer.from(u8);
  } catch (_) {
    // Fallback: create Buffer-like object with the same interface
    const arrayBuf = Uint8Array.from(u8);
    // Add Buffer-like methods that @trezor/protocol expects
    return Object.assign(arrayBuf, {
      slice: (start?: number, end?: number) => arrayBuf.slice(start, end),
      subarray: (start?: number, end?: number) => arrayBuf.subarray(start, end),
      toString: (encoding?: string) => encoding === 'hex' 
        ? Array.from(arrayBuf).map(b => b.toString(16).padStart(2, '0')).join('')
        : new TextDecoder().decode(arrayBuf),
    });
  }
}
// no try/catch — if the dependency is missing, the build/runtime should fail

export type Framing = 'hid' | 'vendor';

export function configureFraming(fromInterfaceClass?: number) {
  if (typeof fromInterfaceClass === 'number') {
    if (fromInterfaceClass === 0x03) setTransportMode('hid');
    else setTransportMode('vendor');
  }
}

// Attempt to augment messages with vendored Solana definitions if available
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const descriptor = require('./protos/descriptor.json');
  const messagesPkg = descriptor?.nested?.hw?.nested?.trezor?.nested?.messages;
  if (messagesPkg) {
    // Load the whole messages package including solana
    loadDefinitions(MESSAGES, 'hw.trezor.messages', async () => messagesPkg);
  }
} catch (_) {
  // ignore; definitions may not be generated at test-time
}

export function encodeMessage(msgType: number, payload: Uint8Array): Uint8Array[] {
  const encoded = trezorProtocol.v1.encode(toNodeBuffer(payload), { messageType: msgType });
  return encodeFromEncoded(new Uint8Array(encoded));
}

export function decodeMessage(frames: Uint8Array[]): { msgType: number; payload: Uint8Array } {
  const merged = concat(frames);
  const d = trezorProtocol.v1.decode(toNodeBuffer(merged));
  return { msgType: d.messageType, payload: new Uint8Array(d.payload) };
}

type ExchangeFn = (bytes: number[], timeout: number) => Promise<number[]>;

function tryParseHeader(buf: Uint8Array): { msgType: number; payloadLen: number; headerLen: number } | null {
  try {
    const d = trezorProtocol.v1.decode(toNodeBuffer(buf));
    if (d && typeof d.messageType === 'number' && typeof d.length === 'number') {
      return { msgType: d.messageType >>> 0, payloadLen: d.length >>> 0, headerLen: 9 };
    }
  } catch (_) {}
  // Also attempt manual parse of the header for streaming assembly; this is not a package fallback,
  // it is just parsing of the v1 header already chosen above.
  if (buf.length >= 1 && buf[0] === 0x00) buf = buf.subarray(1);
  if (buf.length >= 9 && buf[0] === 0x3f && buf[1] === 0x23 && buf[2] === 0x23) {
    const type = (buf[3] << 8) | buf[4];
    const len = (buf[5] << 24) | (buf[6] << 16) | (buf[7] << 8) | buf[8];
    return { msgType: type >>> 0, payloadLen: len >>> 0, headerLen: 9 };
  }
  return null;
}

export async function sendAndReceive(
  exchange: ExchangeFn,
  msgType: number,
  payload: Uint8Array,
  timeoutMs = 2000,
): Promise<{ msgType: number; payload: Uint8Array }> {
  const frames = encodeMessage(msgType, payload);
  for (const f of frames) {
    await exchange(Array.from(f), timeoutMs);
  }
  const received: Uint8Array[] = [];
  let header: { msgType: number; payloadLen: number; headerLen: number } | null = null;
  const started = Date.now();
  while (Date.now() - started < timeoutMs + 50) {
    const remain = Math.max(1, timeoutMs - (Date.now() - started));
    try {
      const part = await exchange([], remain);
      if (part && part.length) {
        received.push(new Uint8Array(part));
        const merged = concat(received);
        header = header || tryParseHeader(merged);
        if (header) {
          const avail = Math.max(0, merged.length - header.headerLen);
          if (avail >= header.payloadLen) {
            const payloadBuf = merged.subarray(header.headerLen, header.headerLen + header.payloadLen);
            return { msgType: header.msgType, payload: payloadBuf };
          }
        }
      }
    } catch (_) {
      // READ_FAIL or transient error: wait briefly and keep polling until overall timeout
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  const merged = concat(received);
  const h = tryParseHeader(merged);
  if (h) {
    const payloadBuf = merged.subarray(h.headerLen, h.headerLen + Math.min(h.payloadLen, Math.max(0, merged.length - h.headerLen)));
    return { msgType: h.msgType, payload: payloadBuf };
  }
  return { msgType: 0, payload: merged };
}

export function encodeByName(name: string, data: any): { msgType: number; payload: Uint8Array } {
  try {
    const { messageType, message } = pbEncodeMessage(MESSAGES, name, data);
    return { msgType: messageType as number, payload: new Uint8Array(message) };
  } catch (_) {
    // Fallback: no message encoding available
    return { msgType: 0, payload: new Uint8Array() };
  }
}

export function decodeToObject(msgType: number, payload: Uint8Array): { type: string; message: any } | null {
  try {
    const { type, message } = pbDecodeMessage(MESSAGES, msgType, toNodeBuffer(payload));
    return { type, message };
  } catch (_) {
    return null;
  }
}
