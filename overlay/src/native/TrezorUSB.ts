import { NativeModules, Platform } from 'react-native';

type UsbDeviceInfo = { vendorId: number; productId: number; deviceName?: string };

const Native = NativeModules.TrezorUsb as
  | {
      listDevices(): Promise<UsbDeviceInfo[]>;
      requestPermission(vendorId: number, productId: number): Promise<boolean>;
      open(vendorId: number, productId: number): Promise<boolean>;
      exchange(bytes: number[], timeoutMs: number): Promise<number[]>;
      close(): Promise<boolean>;
    }
  | undefined;

export const TrezorUSB = {
  isSupported(): boolean {
    return Platform.OS === 'android' && !!Native;
  },
  async list(): Promise<UsbDeviceInfo[]> {
    if (!Native) throw new Error('TrezorUsb native module not available');
    return Native.listDevices();
  },
  async ensurePermission(dev: UsbDeviceInfo): Promise<void> {
    if (!Native) throw new Error('TrezorUsb native module not available');
    await Native.requestPermission(dev.vendorId, dev.productId);
  },
  async open(dev: UsbDeviceInfo): Promise<void> {
    if (!Native) throw new Error('TrezorUsb native module not available');
    const ok = await Native.open(dev.vendorId, dev.productId);
    if (!ok) throw new Error('Failed to open USB connection');
  },
  async exchange(bytes: number[], timeoutMs = 2000): Promise<number[]> {
    if (!Native) throw new Error('TrezorUsb native module not available');
    return Native.exchange(bytes, timeoutMs);
  },
  async close(): Promise<void> {
    if (!Native) return;
    await Native.close();
  },
};

