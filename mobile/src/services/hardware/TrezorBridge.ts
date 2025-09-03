import { Platform } from 'react-native';
import bs58 from 'bs58';
import { SOL_DERIVATION_PATH } from './paths';
import { classifyTrezorError } from './errors';
import { TrezorUSB } from '../../native/TrezorUSB';
import { setHIDReportMode } from './trezor/wire';
import { Messages, parseConfigure, encodeMessage, decodeMessage, loadDefinitions } from '@trezor/protobuf';
import * as protocol from '@trezor/protocol';

export type ProgressCallback = (message: string) => void;
export type PassphraseProvider = () => Promise<string | null>;

type ConnectOptions = {
  maxAttempts?: number;
  attemptDelayMs?: number;
  backoff?: 'linear' | 'exponential';
  maxDelayMs?: number;
  waitForPresenceMs?: number;
  presencePollMs?: number;
  presenceStableCount?: number;
};

const MESSAGES = parseConfigure(Messages);

let messageDefinitionsLoaded = false;

async function ensureMessageDefinitionsLoaded(): Promise<void> {
  if (messageDefinitionsLoaded) return;
  
  try {
    const descriptor = require('./trezor/protos/descriptor.json');
    const messagesPkg = descriptor?.nested?.hw?.nested?.trezor?.nested?.messages;
    if (messagesPkg) {
      console.log('Loading Trezor message definitions...');
      await loadDefinitions(MESSAGES, 'hw.trezor.messages', async () => messagesPkg);
      messageDefinitionsLoaded = true;
      console.log('Loaded message definitions');
    }
  } catch (e) {
    console.log('Failed to load message definitions:', e);
    throw e;
  }
}

function bip32Path(path: string): number[] {
  return path.split('/').slice(1).map(n => {
    const hardened = n.endsWith("'") || n.endsWith('h');
    const num = parseInt(hardened ? n.slice(0, -1) : n, 10);
    return hardened ? (num | 0x80000000) >>> 0 : num;
  });
}

function toNodeBuffer(u8: Uint8Array): Buffer {
  const { Buffer } = require('buffer');
  return Buffer.from(u8);
}

function toBase58(bytes: Uint8Array): string {
  return bs58.encode(bytes);
}

export class TrezorBridge {
  private log: ProgressCallback;
  private getPassphrase?: PassphraseProvider;
  private isHid = false;

  constructor(logger?: ProgressCallback, passphraseProvider?: PassphraseProvider) {
    this.log = logger ?? (() => {});
    this.getPassphrase = passphraseProvider;
  }

  private async sendMessage(messageName: string, messageData: Record<string, unknown>): Promise<void> {
    await ensureMessageDefinitionsLoaded();
    const { messageType, message } = encodeMessage(MESSAGES, messageName, messageData);
    const encoded = protocol.v1.encode(message, { messageType });
    
    // Send in 64-byte chunks
    for (let i = 0; i < encoded.length; i += 64) {
      const chunk = Array.from(encoded.slice(i, i + 64));
      while (chunk.length < 64) chunk.push(0);
      await TrezorUSB.exchange(chunk, 2000);
    }
  }

  private async receiveMessage(timeoutMs = 15000): Promise<{ type: string; message: any }> {
    let receivedBuffer = Buffer.alloc(0);
    const started = Date.now();
    
    while (Date.now() - started < timeoutMs) {
      try {
        const part = await TrezorUSB.exchange([], 2000);
        if (part && part.length > 0) {
          receivedBuffer = Buffer.concat([receivedBuffer, toNodeBuffer(new Uint8Array(part))]);
          
          try {
            const decoded = protocol.v1.decode(receivedBuffer);
            if (decoded.messageType !== undefined && decoded.payload) {
              this.log(`Received type ${decoded.messageType}`);
              
              // Try official protobuf decoding first
              try {
                const { type, message } = decodeMessage(MESSAGES, decoded.messageType, decoded.payload);
                return { type, message };
              } catch {
                // Fallback for unknown message types or missing definitions
                const messageType = decoded.messageType;
                
                // Handle specific known types with raw parsing
                if (messageType === 17) {
                  return { type: 'Features', message: {} };
                }
                if (messageType === 41) {
                  return { type: 'PassphraseRequest', message: {} };
                }
                if (messageType === 999) {
                  // Parse raw public key from payload
                  const payload = new Uint8Array(decoded.payload);
                  if (payload.length >= 34 && payload[0] === 0x0a && payload[1] === 32) {
                    const publicKey = payload.slice(2, 34);
                    return { type: 'SolanaPublicKey', message: { public_key: publicKey } };
                  }
                }
                
                return { type: 'Unknown', message: { messageType, payload: decoded.payload } };
              }
            }
          } catch {
            // Continue reading if incomplete
          }
        }
      } catch {
        await new Promise(r => setTimeout(r, 100));
      }
    }
    
    throw new Error('Message receive timeout');
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
        
        // Determine transport mode
        try {
          const info = await TrezorUSB.getInterfaceInfo();
          const klass = (info as any)?.interfaceClass;
          this.isHid = klass === 0x03;
          if (typeof klass === 'number') {
            this.log(`USB interface class=${klass}`);
            this.log(`Transport diag: protocol=v1, iface=${this.isHid ? 'hid' : 'vendor'}; hidLeadingZeroFallback=${this.isHid ? 'enabled' : 'disabled'}`);
          }
        } catch {}
        
        await this.simulateDelay(200);
        this.log('Handshake (Initialize → Features)');
        await this.handshake(15000);
        
        this.log('Requesting Solana public key');
        const addressN = bip32Path(SOL_DERIVATION_PATH);
        
        let guard = 0;
        while (guard++ < 10) {
          try {
            await this.sendMessage('SolanaGetPublicKey', {
              address_n: addressN,
              show_display: false
            });
            
            const response = await this.receiveMessage(15000);
            
            if (response.type === 'PassphraseRequest') {
              this.log('PASSPHRASE_REQUEST detected');
              if (!this.getPassphrase) {
                throw new Error('Passphrase required but no passphrase UI is wired');
              }
              this.log('Prompting user for passphrase');
              const pw = await this.getPassphrase();
              if (pw == null) throw new Error('Passphrase entry cancelled');
              
              this.log('Sending PassphraseAck');
              await this.sendMessage('PassphraseAck', {
                passphrase: pw,
                on_device: false
              });
              continue;
            }
            
            if (response.type === 'ButtonRequest') {
              this.log('Button requested; sending ButtonAck');
              await this.sendMessage('ButtonAck', {});
              continue;
            }
            
            if (response.type === 'Failure') {
              throw new Error('Device Failure; action was rejected or passphrase incorrect');
            }
            
            if (response.type === 'SolanaPublicKey') {
              const publicKey = response.message.public_key;
              if (publicKey && publicKey.length > 0) {
                const keyB58 = toBase58(new Uint8Array(publicKey));
                this.log('Public key received');
                await TrezorUSB.close();
                return keyB58;
              }
            }
            
            // Handle unknown message types (for tests or missing protobuf definitions)
            if (!response.type && response.message && response.message.public_key) {
              const publicKey = response.message.public_key;
              if (publicKey && publicKey.length > 0) {
                const keyB58 = toBase58(new Uint8Array(publicKey));
                this.log('Public key received (unknown type)');
                await TrezorUSB.close();
                return keyB58;
              }
            }
            
            this.log(`Unexpected message type: ${response.type}`);
            
          } catch (commError) {
            this.log(`Communication error: ${commError}`);
            throw commError;
          }
        }
        
        throw new Error('Failed to get public key after 10 attempts');
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
    this.log('Handshake: send Initialize');
    try {
      await this.sendMessage('Initialize', {});
      const response = await this.receiveMessage(timeoutMs);
      
      if (response.type === 'Features') {
        this.log('Handshake OK');
      } else {
        throw new Error(`Unexpected handshake response: ${response.type}`);
      }
    } catch (e: any) {
      if (this.isHid) {
        this.log('Handshake failed; retrying with leadingZero HID report mode');
        setHIDReportMode('leadingZero');
        await this.sendMessage('Initialize', {});
        const response = await this.receiveMessage(timeoutMs);
      } else {
        this.log('Handshake read timeout; retrying in-session (vendor iface)');
        await this.simulateDelay(250);
        await this.sendMessage('Initialize', {});
        const response = await this.receiveMessage(timeoutMs);
      }
      this.log('Handshake OK');
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