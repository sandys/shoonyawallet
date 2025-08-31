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

    if (Platform.OS === 'ios') {
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
        const { payload: respPayload } = await sendAndReceive(TrezorUSB.exchange, msgType, payload, 3000);
        const { public_key } = decodeSolanaPublicKey(respPayload);
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
    const frames = encodeFrame(initType, payload);
    // Send request frames
    for (const f of frames) {
      await TrezorUSB.exchange(Array.from(f), 2000);
    }
    // Read a single response frame (temporary — replace with loop until full)
    const respFrame = await TrezorUSB.exchange([], 2000);
    const { msgType, payload: resp } = decodeFrames([new Uint8Array(respFrame)]);
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
