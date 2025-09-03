import { Platform } from 'react-native';
import bs58 from 'bs58';
import { SOL_DERIVATION_PATH } from './paths';
import { classifyTrezorError } from './errors';
import { TrezorUSB } from '../../native/TrezorUSB';
import { setHIDReportMode } from './trezor/wire';
import { configureFraming, sendAndReceive, encodeMessage, decodeToObject } from './trezor/transportAdapter';
import { bip32Path, encodeSolanaGetPublicKey, decodeSolanaPublicKey, getMsgTypeId, encodeByName as pEncodeByName } from './trezor/proto';

export type ProgressCallback = (message: string) => void;
export type PassphraseProvider = () => Promise<string | null>;

type ConnectOptions = {
  maxAttempts?: number;
  attemptDelayMs?: number; // base delay
  backoff?: 'linear' | 'exponential';
  maxDelayMs?: number;
  // Optional: wait for device presence before attempting connection
  waitForPresenceMs?: number; // total time to wait for device appearance
  presencePollMs?: number; // poll interval for listDevices
  presenceStableCount?: number; // require N consecutive polls reporting present
};

export class TrezorBridge {
  private log: ProgressCallback;
  private getPassphrase?: PassphraseProvider;
  private isHid = false;
  private static MSG = {
    FEATURES: 17,
    FAILURE: 3,
    BUTTON_REQUEST: 26,
    BUTTON_ACK: 27,
    PASSPHRASE_REQUEST: 41,
    PASSPHRASE_ACK: 42,
  } as const;

  constructor(logger?: ProgressCallback, passphraseProvider?: PassphraseProvider) {
    this.log = logger ?? (() => {});
    this.getPassphrase = passphraseProvider;
  }

  async connectAndGetPublicKey(opts: ConnectOptions = {}): Promise<string> {
    const { maxAttempts = 6, attemptDelayMs = 1000, backoff = 'exponential', maxDelayMs = 8000, waitForPresenceMs = 60000, presencePollMs = 500, presenceStableCount = 2 } = opts;

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
        
        // Wait longer for device to appear and stabilize when locked
        const found = await this.waitForDevicePresence(
          attempt === 1 ? waitForPresenceMs : Math.max(10000, attemptDelayMs * 5), 
          presencePollMs, 
          presenceStableCount
        );
        if (!found) {
          this.log(`Attempt ${attempt}: No device detected during presence wait`);
          throw new Error('No Trezor device found');
        }
        this.log(`Device presence confirmed; debouncing 500ms`);
        await this.simulateDelay(500);
        
        const devices = await TrezorUSB.list();
        if (!devices.length) {
          throw new Error('No Trezor device found after presence confirmed');
        }
        const dev = devices[0];
        this.log(`Selecting device vid=${dev.vendorId} pid=${dev.productId} name=${dev.deviceName ?? '-'} for attempt ${attempt}`);
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
        await this.handshake(15000);
        this.log('Exchanging messages (public key request)');
        const addressN = bip32Path(SOL_DERIVATION_PATH);
        const payload = encodeSolanaGetPublicKey(addressN, false);
        const msgType = getMsgTypeId('MessageType_SolanaGetPublicKey');
        this.log(`Send SolanaGetPublicKey type=${msgType} bytes=${payload.length}`);
        let keyB58: string | null = null;
        let guard = 0;
        while (guard++ < 6 && !keyB58) {
          const { msgType: respType, payload: respPayload } = await sendAndReceive(TrezorUSB.exchange, msgType, payload, 8000);
          this.log(`Recv type=${respType} bytes=${respPayload.length}`);
          // If we failed to parse a proper header, do not attempt to decode as SolanaPublicKey.
          if (respType === 0) {
            this.log('Unknown/partial message; waiting for next response');
            continue;
          }
          if (respType === TrezorBridge.MSG.PASSPHRASE_REQUEST) {
            // Trezor Safe 3 and newer models require host-based passphrase entry
            if (!this.getPassphrase) {
              throw new Error('Passphrase required but no passphrase UI is wired');
            }
            this.log('Passphrase requested; prompting user for host entry');
            const pw = await this.getPassphrase();
            if (pw == null) throw new Error('Passphrase entry cancelled');
            const ack = encodePassphraseAckHost(pw);
            this.log('Sending PassphraseAck with host entry');
            await sendOnly(TrezorUSB.exchange, TrezorBridge.MSG.PASSPHRASE_ACK, ack);
            this.log('PassphraseAck sent, waiting for device response');
            continue;
          }
          if (respType === TrezorBridge.MSG.BUTTON_REQUEST) {
            this.log('Button requested; sending ButtonAck');
            await sendOnly(TrezorUSB.exchange, TrezorBridge.MSG.BUTTON_ACK, new Uint8Array());
            continue;
          }
          if (respType === TrezorBridge.MSG.FAILURE) {
            throw new Error('Device Failure; action was rejected or passphrase incorrect');
          }
          const { public_key } = decodeSolanaPublicKey(respPayload);
          const keyBytes = public_key ?? new Uint8Array();
          this.log(`Decoded pubkey bytes=${keyBytes.length}`);
          if (keyBytes.length === 0) {
            // Loop again if device needs another round (e.g., after ack)
            continue;
          }
          keyB58 = toBase58(keyBytes);
        }
        if (!keyB58) throw new Error('Empty public key payload');
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
    const initType = getMsgTypeId('MessageType_Initialize');
    const payload = pEncodeByName('Initialize', {});
    this.log(`Handshake: send Initialize type=${initType} bytes=${payload.length}`);
    let msgType: number, resp: Uint8Array;
    try {
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
      // Try decode with adapter to validate response (best-effort)
      try { decodeToObject(msgType, resp); } catch {}
      this.log('Handshake OK');
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      this.log(`Handshake FAILED: ${msg}`);
      throw e;
    }
  }

  private async waitForDevicePresence(maxWaitMs: number, pollMs: number, requiredConsecutive = 1): Promise<boolean> {
    const start = Date.now();
    let consecutive = 0;
    while (Date.now() - start < maxWaitMs) {
      try {
        const devices = await TrezorUSB.list();
        if (devices && devices.length) {
          consecutive += 1;
          if (consecutive >= requiredConsecutive) return true;
        } else {
          consecutive = 0;
        }
      } catch {}
      await this.simulateDelay(pollMs);
    }
    return false;
  }
}

async function sendOnly(
  exchange: (bytes: number[], timeout: number) => Promise<number[]>,
  msgType: number,
  payload: Uint8Array,
  timeoutMs = 2000,
) {
  const frames = encodeMessage(msgType, payload);
  for (const f of frames) {
    await exchange(Array.from(f), timeoutMs);
  }
}

function toBase58(bytes: Uint8Array): string {
  return bs58.encode(bytes);
}

function encodePassphraseAckHost(passphrase: string): Uint8Array {
  // PassphraseAck: field 1 (passphrase) = string, field 2 (on_device)=false
  const str = new TextEncoder().encode(passphrase);
  const out: number[] = [];
  // field 1, length-delimited
  out.push((1 << 3) | 2);
  // length of string
  writeVarint(out, str.length >>> 0);
  for (let i = 0; i < str.length; i++) out.push(str[i]);
  // field 2, varint = 0 (false)
  out.push((2 << 3) | 0, 0);
  return Uint8Array.from(out);
}

function writeVarint(out: number[], v: number) {
  while (v > 0x7f) { out.push((v & 0x7f) | 0x80); v >>>= 7; }
  out.push(v);
}

// hex helpers removed; no longer needed with protobuf decode
