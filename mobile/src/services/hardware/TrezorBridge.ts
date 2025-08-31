import { Platform } from 'react-native';
import { SOL_DERIVATION_PATH } from './paths';
import { classifyTrezorError } from './errors';
import { TrezorUSB } from '../../native/TrezorUSB';
import { encodeFrame, decodeFrames, sendAndReceive } from './trezor/wire';
import { bip32Path, encodeSolanaGetPublicKey, decodeSolanaPublicKey, getMsgTypeId, encodeByName, decodeByName } from './trezor/proto';

export type ProgressCallback = (message: string) => void;

type ConnectOptions = {
  maxAttempts?: number;
  attemptDelayMs?: number; // base delay
  backoff?: 'linear' | 'exponential';
  maxDelayMs?: number;
};

export class TrezorBridge {
  private log: ProgressCallback;

  constructor(logger?: ProgressCallback) {
    this.log = logger ?? (() => {});
  }

  async connectAndGetPublicKey(opts: ConnectOptions = {}): Promise<string> {
    const { maxAttempts = 3, attemptDelayMs = 800, backoff = 'linear', maxDelayMs = 5000 } = opts;

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
        this.log('Handshake (Initialize → Features)');
        await this.handshake();
        this.log('Exchanging messages (public key request)');
        const addressN = bip32Path(SOL_DERIVATION_PATH);
        const payload = encodeSolanaGetPublicKey(addressN, false);
        const msgType = getMsgTypeId('MessageType_SolanaGetPublicKey');
        this.log(`Send SolanaGetPublicKey type=${msgType} bytes=${payload.length}`);
        const { msgType: respType, payload: respPayload } = await sendAndReceive(TrezorUSB.exchange, msgType, payload, 3000);
        this.log(`Recv type=${respType} bytes=${respPayload.length}`);
        const { public_key } = decodeSolanaPublicKey(respPayload);
        this.log(`Decoded pubkey bytes=${public_key.length}`);
        const keyB58 = toBase58(public_key);
        this.log('Public key received');
        await TrezorUSB.close();
        return keyB58;
      } catch (e) {
        lastErr = e;
        const msg = e instanceof Error ? e.message : String(e);
        const cls = classifyTrezorError(msg);
        this.log(`Attempt failed: ${msg} [${cls.code}]`);
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

  private async handshake() {
    const initType = getMsgTypeId('MessageType_Initialize');
    const featuresType = getMsgTypeId('MessageType_Features');
    const payload = encodeByName('Initialize', {});
    this.log(`Handshake: send Initialize type=${initType} bytes=${payload.length}`);
    const { msgType, payload: resp } = await sendAndReceive(TrezorUSB.exchange, initType, payload, 3000);
    this.log(`Handshake: recv type=${msgType} bytes=${resp.length}`);
    if (msgType !== featuresType) {
      // Some devices answer with Success or different wrapper; try decode to detect
      try { decodeByName('Features', resp); }
      catch { throw new Error('Handshake failed: unexpected response'); }
    }
  }
}

function toBase58(bytes: Uint8Array): string {
  // lightweight base58 encode using bs58 from node_modules
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const bs58 = require('bs58');
  return bs58.encode(Buffer.from(bytes));
}
