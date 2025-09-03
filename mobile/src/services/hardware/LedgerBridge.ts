import { PermissionsAndroid, Platform } from 'react-native';

export type LedgerDevice = { id: string; name?: string | null };

type TransportBLEType = {
  list: () => Promise<LedgerDevice[]>;
  open: (id: string) => Promise<any>;
};

type SolanaAppType = new (transport: any) => {
  getAppConfiguration: () => Promise<{ version?: string; name?: string }>;
  signTransaction: (path: string, tx: Uint8Array) => Promise<{ signature: Uint8Array } | Uint8Array>;
};

async function getTransportBLE(): Promise<TransportBLEType | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@ledgerhq/react-native-hw-transport-ble');
    return (mod.default ?? mod) as TransportBLEType;
  } catch (e) {
    return null;
  }
}

async function getSolanaApp(): Promise<SolanaAppType | null> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('@ledgerhq/hw-app-solana');
    return (mod.default ?? mod) as SolanaAppType;
  } catch (e) {
    return null;
  }
}

async function ensureBluetoothPermissions(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const res = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT as any,
      {
        title: 'Bluetooth Permission',
        message: 'Allow Bluetooth to connect to Ledger Nano X',
        buttonPositive: 'OK',
      },
    );
    return res === PermissionsAndroid.RESULTS.GRANTED;
  } catch (_) {
    return false;
  }
}

export class LedgerBridge {
  private transport: any | null = null;
  private solana: InstanceType<SolanaAppType> | null = null;

  async initialize(): Promise<void> {
    await ensureBluetoothPermissions();
  }

  async scanForDevices(): Promise<LedgerDevice[]> {
    const TransportBLE = await getTransportBLE();
    if (!TransportBLE) return [];
    try {
      const list = await TransportBLE.list();
      return list ?? [];
    } catch (_) {
      return [];
    }
  }

  async connect(deviceId: string): Promise<void> {
    const TransportBLE = await getTransportBLE();
    if (!TransportBLE) {
      throw new Error('Ledger BLE transport not available. Add @ledgerhq/react-native-hw-transport-ble');
    }
    const SolanaApp = await getSolanaApp();
    if (!SolanaApp) {
      throw new Error('Ledger Solana app library missing. Add @ledgerhq/hw-app-solana');
    }
    this.transport = await TransportBLE.open(deviceId);
    this.solana = new SolanaApp(this.transport);
    const cfg = (await this.solana.getAppConfiguration()) || {};
    const appName = (cfg as any).name || (cfg as any).appName || '';
    if (appName && typeof appName === 'string' && appName.toLowerCase().indexOf('solana') === -1) {
      throw new Error('Wrong app open on Ledger. Please open Solana');
    }
  }

  async signTransaction(serializedTx: Uint8Array, path = "44'/501'/0'"): Promise<Uint8Array> {
    if (!this.solana) throw new Error('Ledger not connected');
    const res = await this.solana.signTransaction(path, serializedTx);
    const sigBuf: Uint8Array = (res as any).signature ?? (res as any);
    return sigBuf;
  }

  async disconnect(): Promise<void> {
    try {
      if (this.transport && this.transport.close) await this.transport.close();
    } finally {
      this.transport = null;
      this.solana = null;
    }
  }
}

