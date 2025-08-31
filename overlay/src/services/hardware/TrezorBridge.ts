import { Platform } from 'react-native';

export type ProgressCallback = (message: string) => void;

type ConnectOptions = {
  maxAttempts?: number;
  attemptDelayMs?: number;
};

export class TrezorBridge {
  private log: ProgressCallback;

  constructor(logger?: ProgressCallback) {
    this.log = logger ?? (() => {});
  }

  async connectAndGetPublicKey(opts: ConnectOptions = {}): Promise<string> {
    const { maxAttempts = 3, attemptDelayMs = 800 } = opts;

    if (Platform.OS === 'ios') {
      throw new Error('USB Trezor not supported on iOS');
    }

    this.log('Preparing USB transport...');
    // TODO: Integrate Android USB access and Trezor protocol/Connect here.
    // Placeholder retry loop to demonstrate robust flow and user feedback.
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        this.log(`Attempt ${attempt}/${maxAttempts}: finding device`);
        await this.simulateDelay(400);
        this.log('Requesting permission');
        await this.simulateDelay(400);
        this.log('Opening session');
        await this.simulateDelay(600);
        this.log('Deriving Solana public key');
        await this.simulateDelay(600);
        // Return a deterministic fake key shape for now; replace with real device call
        const fakePub = '6xHkR2Wgk9C5Zc5KcQ7jv5bLqYwV8p9b2q3x1yZabcde';
        this.log('Public key received');
        return fakePub;
      } catch (e) {
        lastErr = e;
        this.log(`Attempt failed: ${e instanceof Error ? e.message : String(e)}`);
        if (attempt < maxAttempts) {
          this.log('Retrying...');
          await this.simulateDelay(attemptDelayMs);
        }
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('Failed to connect to Trezor');
  }

  private async simulateDelay(ms: number) {
    return new Promise((res) => setTimeout(res, ms));
  }
}

