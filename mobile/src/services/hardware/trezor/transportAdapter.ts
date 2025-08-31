// Adapter that prefers @trezor/transport for framing if available,
// otherwise falls back to our local wire implementation.

import type { TrezorUSB } from '../../../native/TrezorUSB';
import { setTransportMode, setHIDReportMode, encodeFrame, encodeFromEncoded, decodeFrames, concat } from './wire';
import { Messages, parseConfigure, encodeMessage as pbEncodeMessage, decodeMessage as pbDecodeMessage, loadDefinitions } from '@trezor/protobuf';
const MESSAGES = parseConfigure(Messages);

let trezorProtocol: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  trezorProtocol = require('@trezor/protocol');
} catch (_) {
  trezorProtocol = null;
}

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
  if (trezorProtocol?.v1?.encode) {
    try {
      const encoded: Buffer = trezorProtocol.v1.encode(Buffer.from(payload), { messageType: msgType });
      return encodeFromEncoded(new Uint8Array(encoded));
    } catch (_) {
      // fall through
    }
  }
  return encodeFrame(msgType, payload);
}

export function decodeMessage(frames: Uint8Array[]): { msgType: number; payload: Uint8Array } {
  const merged = concat(frames);
  if (trezorProtocol?.v1?.decode) {
    try {
      const d = trezorProtocol.v1.decode(Buffer.from(merged));
      return { msgType: d.messageType, payload: new Uint8Array(d.payload) };
    } catch (_) {
      // fall back
    }
  }
  return decodeFrames(frames);
}

type ExchangeFn = (bytes: number[], timeout: number) => Promise<number[]>;

function tryParseHeader(buf: Uint8Array): { msgType: number; payloadLen: number; headerLen: number } | null {
  // Use official decoder if available
  if (trezorProtocol?.v1?.decode) {
    try {
      const d = trezorProtocol.v1.decode(Buffer.from(buf));
      if (d && typeof d.messageType === 'number' && typeof d.length === 'number') {
        return { msgType: d.messageType >>> 0, payloadLen: d.length >>> 0, headerLen: 9 };
      }
    } catch (_) {}
  }
  // skip leading 0x00 if present
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
    const { type, message } = pbDecodeMessage(MESSAGES, msgType, Buffer.from(payload));
    return { type, message };
  } catch (_) {
    return null;
  }
}
