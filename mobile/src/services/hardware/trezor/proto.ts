import * as protobuf from 'protobufjs/minimal';

let root: protobuf.Root | null = null;

function loadRoot(): protobuf.Root {
  if (root) return root;
  try {
    // Prefer descriptor generated in CI from official Trezor protos
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const descriptor = require('./protos/descriptor.json');
    root = protobuf.Root.fromJSON(descriptor);
    return root!;
  } catch (_) {
    // Fallback to minimal inline definitions for Solana public key only (may not work with device)
    const protoSrc = `
      syntax = "proto3";
      package trezor.solana;
      message SolanaGetPublicKey { repeated uint32 address_n = 1; bool show_display = 2; }
      message SolanaPublicKey { bytes public_key = 1; }
    `;
    root = protobuf.parse(protoSrc).root;
    return root!;
  }
}

export function encodeSolanaGetPublicKey(addressN: number[], showDisplay: boolean): Uint8Array {
  const r = loadRoot();
  const Type = r.lookupType('trezor.solana.SolanaGetPublicKey') || r.lookupType('hw.trezor.messages.solana.SolanaGetPublicKey');
  const msg = (Type as any).create({ address_n: addressN, show_display: showDisplay });
  return (Type as any).encode(msg).finish();
}

export function decodeSolanaPublicKey(buf: Uint8Array): { public_key: Uint8Array } {
  const r = loadRoot();
  const Type = r.lookupType('trezor.solana.SolanaPublicKey') || r.lookupType('hw.trezor.messages.solana.SolanaPublicKey');
  const obj = (Type as any).decode(buf) as any;
  const pk: Uint8Array = obj.public_key || obj.publicKey || new Uint8Array();
  return { public_key: pk };
}

export function getMsgTypeId(name: string): number {
  const r = loadRoot();
  // enum may be at root or packaged, try common paths
  const enumPaths = ['MessageType', 'hw.trezor.messages.MessageType'];
  for (const p of enumPaths) {
    const E = r.lookupEnum(p) as any;
    if (E && E.values && E.values[name] != null) return E.values[name];
  }
  return 0;
}

export function encodeByName(name: string, obj: any): Uint8Array {
  const r = loadRoot();
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
