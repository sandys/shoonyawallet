// Avoid hard dependency on protobufjs in test or minimal envs.
// Dynamically require it when available; otherwise fall back to minimal codecs.
let PB: any = null;
let root: any | null = null;
let descriptorLoaded = false;

function loadRoot(): any {
  if (root) return root;
  try {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      PB = require('protobufjs');
    } catch (_) {
      PB = null;
    }
    // Prefer descriptor generated in CI from official Trezor protos
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const descriptor = require('./protos/descriptor.json');
    if (!PB) throw new Error('protobufjs missing');
    root = PB.Root.fromJSON(descriptor);
    descriptorLoaded = true;
    return root!;
  } catch (_) {
    // Fallback: no descriptor; use manual minimal codecs
    descriptorLoaded = false;
    root = PB ? new PB.Root() : { lookupType: () => null, lookupTypeOrEnum: () => null, lookupEnum: () => null };
    return root!;
  }
}

export function encodeSolanaGetPublicKey(addressN: number[], showDisplay: boolean): Uint8Array {
  const r = loadRoot();
  if (descriptorLoaded) {
    const Type = r.lookupType('trezor.solana.SolanaGetPublicKey') || r.lookupType('hw.trezor.messages.solana.SolanaGetPublicKey');
    const msg = (Type as any).create({ address_n: addressN, show_display: showDisplay });
    return (Type as any).encode(msg).finish();
  }
  // Manual minimal encoding: field 1 (address_n) repeated varint, field 2 (bool)
  const out: number[] = [];
  for (const n of addressN) { writeVarint(out, (1 << 3) | 0); writeVarint(out, n >>> 0); }
  writeVarint(out, (2 << 3) | 0); out.push(showDisplay ? 1 : 0);
  return Uint8Array.from(out);
}

export function decodeSolanaPublicKey(buf: Uint8Array): { public_key: Uint8Array } {
  const r = loadRoot();
  if (descriptorLoaded) {
    const Type = r.lookupType('trezor.solana.SolanaPublicKey') || r.lookupType('hw.trezor.messages.solana.SolanaPublicKey');
    const obj = (Type as any).decode(buf) as any;
    const pk: Uint8Array = obj.public_key || obj.publicKey || new Uint8Array();
    return { public_key: pk };
  }
  // Manual minimal decoding: field 1 (length-delimited) with bytes
  const [tag, o1] = readVarint(buf, 0);
  if (tag !== ((1 << 3) | 2)) return { public_key: new Uint8Array() };
  const [len, o2] = readVarint(buf, o1);
  return { public_key: buf.subarray(o2, o2 + len) };
}

export function getMsgTypeId(name: string): number {
  const r = loadRoot();
  // enum may be at root or packaged, try common paths
  const enumPaths = ['MessageType', 'hw.trezor.messages.MessageType'];
  for (const p of enumPaths) {
    try {
      const E = (r as any).lookupEnum ? (r as any).lookupEnum(p) : null;
      if (E && E.values && E.values[name] != null) return E.values[name];
    } catch (_) {
      // ignore and try next
    }
  }
  // Fallback IDs for tests / no descriptor
  const fallback: Record<string, number> = {
    MessageType_Initialize: 100,
    MessageType_Features: 1000,
    MessageType_SolanaGetPublicKey: 200,
    MessageType_SolanaPublicKey: 999,
  };
  return fallback[name] ?? 0;
}

export function encodeByName(name: string, obj: any): Uint8Array {
  const r = loadRoot();
  if (!descriptorLoaded) return new Uint8Array();
  const candidates = [
    name,
    `hw.trezor.messages.${name}`,
    `hw.trezor.messages.common.${name}`,
    `hw.trezor.messages.management.${name}`,
  ];
  for (const n of candidates) {
    const t = r.lookupTypeOrEnum(n) as any;
    if (t && t.encode) {
      const msg = t.create ? t.create(obj) : obj;
      return t.encode(msg).finish();
    }
  }
  // No type found → return empty payload
  return new Uint8Array();
}

export function decodeByName(name: string, buf: Uint8Array): any {
  const r = loadRoot();
  if (!descriptorLoaded) return {};
  const candidates = [
    name,
    `hw.trezor.messages.${name}`,
    `hw.trezor.messages.common.${name}`,
    `hw.trezor.messages.management.${name}`,
  ];
  for (const n of candidates) {
    const t = r.lookupTypeOrEnum(n) as any;
    if (t && t.decode) {
      return t.decode(buf);
    }
  }
  return {};
}

export function bip32Path(path: string): number[] {
  const HARDENED = 0x80000000;
  const m = path.trim();
  const parts = m.replace(/^m\//, '').split('/');
  return parts.map((p) => {
    const hardened = p.endsWith("'");
    const n = parseInt(p.replace("'", ''), 10);
    return hardened ? (n | HARDENED) >>> 0 : n >>> 0;
  });
}

function writeVarint(out: number[], v: number) {
  while (v > 0x7f) { out.push((v & 0x7f) | 0x80); v >>>= 7; }
  out.push(v);
}
function readVarint(buf: Uint8Array, off: number): [number, number] {
  let res = 0, shift = 0, pos = off;
  while (pos < buf.length) {
    const b = buf[pos++];
    res |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  return [res >>> 0, pos];
}
