import { Platform } from 'react-native';
import TrezorConnect, { DEVICE_EVENT, UI_EVENT } from '@trezor/connect';
import type { UiRequest } from '@trezor/connect/lib/events/ui';
import type { Device } from '@trezor/connect/lib/types/trezor';
import { SOL_DERIVATION_PATH } from './paths';
import { classifyTrezorError } from './errors';

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

    this.log('Initializing Trezor Connect...');
    try {
      await TrezorConnect.init({
        manifest: {
          email: 'dev@shoonyawallet.org',
          appUrl: 'https://github.com/yourorg/shoonyawallet',
        },
      });
    } catch (e) {
      this.log('TrezorConnect init failed, will still retry');
    }

    // Subscriptions (logging only; app is single-device for MVP)
    TrezorConnect.on(DEVICE_EVENT, (ev) => {
      const dev = (ev?.payload as Device | undefined)?.label ?? 'device';
      this.log(`Device event: ${ev.type} (${dev})`);
    });
    TrezorConnect.on(UI_EVENT, (ev: any) => {
      const r = (ev?.payload as UiRequest | undefined)?.type ?? ev.type;
      this.log(`UI event: ${r}`);
    });

    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        this.log(`Attempt ${attempt}/${maxAttempts}: request Solana public key`);
        // Optional preflight; helps surface permission prompts early on some devices
        try { await (TrezorConnect as any).getFeatures?.(); } catch {}
        const res = await TrezorConnect.solanaGetPublicKey({
          path: SOL_DERIVATION_PATH,
          showOnTrezor: false,
        });
        if (!res.success) {
          throw new Error(res.payload?.error ?? 'Unknown trezor error');
        }
        const key = res.payload?.publicKey as string;
        if (!key) throw new Error('Empty public key from device');
        this.log('Public key received');
        return key;
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
}
