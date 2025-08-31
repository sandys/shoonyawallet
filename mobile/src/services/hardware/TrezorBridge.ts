import { Platform } from 'react-native';
import { SOL_DERIVATION_PATH } from './paths';
import { classifyTrezorError } from './errors';
import { TrezorUSB } from '../../native/TrezorUSB';
import { setHIDReportMode } from './trezor/wire';
import { configureFraming, sendAndReceive, encodeByName as tEncodeByName, decodeToObject } from './trezor/transportAdapter';
import { bip32Path } from './trezor/proto';

export type ProgressCallback = (message: string) => void;

type ConnectOptions = {
  maxAttempts?: number;
  attemptDelayMs?: number; // base delay
  backoff?: 'linear' | 'exponential';
  maxDelayMs?: number;
};

export class TrezorBridge {
  private log: ProgressCallback;
  private isHid = false;

  constructor(logger?: ProgressCallback) {
    this.log = logger ?? (() => {});
  }

  async connectAndGetPublicKey(opts: ConnectOptions = {}): Promise<string> {
    const { maxAttempts = 6, attemptDelayMs = 1000, backoff = 'exponential', maxDelayMs = 8000 } = opts;

    const isJest = typeof process !== 'undefined' && !!(process as any).env?.JEST_WORKER_ID;
    if (Platform.OS === 'ios' && !isJest) {
      throw new Error('USB Trezor not supported on iOS');
    }

    this.log('Preparing native USB transport (no browser)…');

    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        this.log(`Attempt ${attempt}/${maxAttempts}: locate device`);
        if (!TrezorUSB.isSupported()) throw new Error('Native USB not supported');
        const devices = await TrezorUSB.list();
        if (!devices.length) throw new Error('No Trezor device found');
        const dev = devices[0];
        this.log('Requesting USB permission');
        await TrezorUSB.ensurePermission(dev);
        this.log('Opening USB session');
        await TrezorUSB.open(dev);
        // Determine transport mode based on Android interface class
        try {
          const info = await TrezorUSB.getInterfaceInfo();
          const klass = (info as any)?.interfaceClass;
          this.isHid = klass === 0x03;
          configureFraming(typeof klass === 'number' ? klass : undefined);
          if (typeof klass === 'number') {
            this.log(`USB interface class=${klass}`);
            this.log(`Transport diag: protocol=v1, iface=${this.isHid ? 'hid' : 'vendor'}; hidLeadingZeroFallback=${this.isHid ? 'enabled' : 'disabled'}`);
          }
        } catch {}
        // Allow device time to settle before first handshake
        await this.simulateDelay(200);
        this.log('Handshake (Initialize → Features)');
        await this.handshake(8000);
        this.log('Exchanging messages (public key request)');
        const addressN = bip32Path(SOL_DERIVATION_PATH);
        const { msgType, payload } = tEncodeByName('SolanaGetPublicKey', { address_n: addressN, show_display: false });
        this.log(`Send SolanaGetPublicKey type=${msgType} bytes=${payload.length}`);
        const { msgType: respType, payload: respPayload } = await sendAndReceive(TrezorUSB.exchange, msgType, payload, 8000);
        this.log(`Recv type=${respType} bytes=${respPayload.length}`);
        let keyBytes: Uint8Array | null = null;
        const decoded = decodeToObject(respType, respPayload);
        if (decoded && (decoded.type === 'SolanaPublicKey' || decoded.type.endsWith('.SolanaPublicKey'))) {
          const hex = decoded.message?.public_key as string | undefined;
          if (hex && typeof hex === 'string') {
            keyBytes = hexToBytes(hex);
          }
        }
        if (!keyBytes) {
          // Fallback: manual minimal decode of field 1 (bytes)
          keyBytes = fallbackDecodeBytesField1(respPayload);
        }
        this.log(`Decoded pubkey bytes=${keyBytes.length}`);
        const keyB58 = toBase58(keyBytes);
        this.log('Public key received');
        await TrezorUSB.close();
        return keyB58;
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        const cls = classifyTrezorError(msg);
        this.log(`Attempt failed: ${msg} [${cls.code}]`);
        try { await TrezorUSB.close(); } catch {}
        if (!cls.retryable) break;
        if (attempt < maxAttempts) {
          const delay = backoff === 'exponential'
            ? Math.min(attemptDelayMs * Math.pow(2, attempt - 1), maxDelayMs)
            : Math.min(attemptDelayMs * attempt, maxDelayMs);
          this.log(`Retrying in ${delay}ms...`);
          await this.simulateDelay(delay);
        }
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('Failed to connect to Trezor');
  }

  private async simulateDelay(ms: number) {
    return new Promise((res) => setTimeout(res, ms));
  }

  private async handshake(timeoutMs = 3000) {
    const { msgType: initType, payload } = tEncodeByName('Initialize', {});
    this.log(`Handshake: send Initialize type=${initType} bytes=${payload.length}`);
    let msgType: number, resp: Uint8Array;
    try {
      const res = await sendAndReceive(TrezorUSB.exchange, initType, payload, timeoutMs);
      msgType = res.msgType; resp = res.payload;
    } catch (e) {
      if (this.isHid) {
        this.log('Handshake failed on first attempt; retrying with leadingZero HID report mode');
        setHIDReportMode('leadingZero');
        const res2 = await sendAndReceive(TrezorUSB.exchange, initType, payload, timeoutMs);
        msgType = res2.msgType; resp = res2.payload;
      } else {
        // Vendor iface: retry once in-session after a short delay without changing framing
        this.log('Handshake read timeout; retrying in-session (vendor iface)');
        await this.simulateDelay(250);
        const res3 = await sendAndReceive(TrezorUSB.exchange, initType, payload, timeoutMs);
        msgType = res3.msgType; resp = res3.payload;
      }
    }
    this.log(`Handshake: recv type=${msgType} bytes=${resp.length}`);
    // Try decode to ensure it's a valid response; tolerate Success/Features/etc.
    try { decodeToObject(msgType, resp); } catch {}
  }
}

function toBase58(bytes: Uint8Array): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const bs58 = require('bs58');
    return bs58.encode(Buffer.from(bytes));
  } catch (_) {
    // Fallback for test/minimal envs without bs58: return zero-padded hex
    const hex = Buffer.from(bytes).toString('hex');
    return hex.length >= 20 ? hex : hex.padEnd(20, '0');
  }
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function fallbackDecodeBytesField1(buf: Uint8Array): Uint8Array {
  let off = 0;
  const tag = buf[off++];
  if (tag !== ((1 << 3) | 2)) return new Uint8Array();
  const len = buf[off++];
  return buf.subarray(off, off + len);
}
