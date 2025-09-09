import { EventEmitter, Subscription } from 'expo-modules-core';

import { NativeDevice, OnConnectEvent, WebUSBDevice } from './ReactNativeUsb.types';
import ReactNativeUsbModule from './ReactNativeUsbModule';

const emitter = new EventEmitter(ReactNativeUsbModule ?? {});

const debug = (...args: any[]) => {
  if (__DEV__) {
    console.log('[ReactNativeUsb]', ...args);
  }
};

const connectedDevicesMap = new Map<string, WebUSBDevice>();

function createDeviceId(device: NativeDevice): string {
  return `${device.vendorId}-${device.productId}-${device.serialNumber ?? 'unknown'}`;
}

function createWebUSBDevice(nativeDevice: NativeDevice): WebUSBDevice {
  const deviceId = createDeviceId(nativeDevice);

  return {
    opened: false,
    usbVersionMajor: 2,
    usbVersionMinor: 0,
    usbVersionSubminor: 0,
    deviceClass: nativeDevice.deviceClass,
    deviceSubclass: nativeDevice.deviceSubclass,
    deviceProtocol: nativeDevice.deviceProtocol,
    vendorId: nativeDevice.vendorId,
    productId: nativeDevice.productId,
    deviceVersionMajor: nativeDevice.deviceVersionMajor,
    deviceVersionMinor: nativeDevice.deviceVersionMinor,
    deviceVersionSubminor: nativeDevice.deviceVersionSubminor,
    manufacturerName: nativeDevice.manufacturerName,
    productName: nativeDevice.productName,
    serialNumber: nativeDevice.serialNumber,
    configurations: [],

    async open() {
      debug('Opening device', deviceId);
      await ReactNativeUsbModule.open(nativeDevice);
      this.opened = true;
    },

    async close() {
      debug('Closing device', deviceId);
      await ReactNativeUsbModule.close(nativeDevice);
      this.opened = false;
    },

    async forget() {
      debug('Forgetting device', deviceId);
      // No native implementation needed
    },

    async selectConfiguration(configurationValue: number) {
      debug('Selecting configuration', configurationValue);
      // No native implementation needed for now
    },

    async claimInterface(interfaceNumber: number) {
      debug('Claiming interface', interfaceNumber);
      await ReactNativeUsbModule.claimInterface(nativeDevice, interfaceNumber);
    },

    async releaseInterface(interfaceNumber: number) {
      debug('Releasing interface', interfaceNumber);
      await ReactNativeUsbModule.releaseInterface(nativeDevice, interfaceNumber);
    },

    async selectAlternateInterface(interfaceNumber: number, alternateSetting: number) {
      debug('Selecting alternate interface', interfaceNumber, alternateSetting);
      // No native implementation needed for now
    },

    async controlTransferIn(setup: any, length: number) {
      debug('Control transfer in', setup, length);
      throw new Error('Not implemented');
    },

    async controlTransferOut(setup: any, data?: BufferSource) {
      debug('Control transfer out', setup, data);
      throw new Error('Not implemented');
    },

    async clearHalt(direction: any, endpointNumber: number) {
      debug('Clear halt', direction, endpointNumber);
      throw new Error('Not implemented');
    },

    async transferIn(endpointNumber: number, length: number) {
      debug('Transfer in', endpointNumber, length);
      const result = await ReactNativeUsbModule.transferIn(nativeDevice, endpointNumber, length);
      return {
        data: new DataView(new ArrayBuffer(result.length)),
        status: 'ok',
      };
    },

    async transferOut(endpointNumber: number, data: BufferSource) {
      debug('Transfer out', endpointNumber, data);
      const dataArray = new Uint8Array(data);
      const result = await ReactNativeUsbModule.transferOut(nativeDevice, endpointNumber, Array.from(dataArray));
      return {
        bytesWritten: result.bytesWritten,
        status: 'ok',
      };
    },

    async isochronousTransferIn(endpointNumber: number, packetLengths: number[]) {
      debug('Isochronous transfer in', endpointNumber, packetLengths);
      throw new Error('Not implemented');
    },

    async isochronousTransferOut(endpointNumber: number, data: BufferSource, packetLengths: number[]) {
      debug('Isochronous transfer out', endpointNumber, data, packetLengths);
      throw new Error('Not implemented');
    },

    async reset() {
      debug('Resetting device', deviceId);
      await ReactNativeUsbModule.reset(nativeDevice);
    },
  };
}

export function onDeviceConnected(listener: (device: WebUSBDevice) => void): Subscription {
  return emitter.addListener<OnConnectEvent>('onConnect', (event) => {
    debug('Device connected', event.device);
    const deviceId = createDeviceId(event.device);
    const webUSBDevice = createWebUSBDevice(event.device);
    connectedDevicesMap.set(deviceId, webUSBDevice);
    listener(webUSBDevice);
  });
}

export function onDeviceDisconnect(listener: (device: WebUSBDevice) => void): Subscription {
  return emitter.addListener<OnConnectEvent>('onDisconnect', (event) => {
    debug('Device disconnected', event.device);
    const deviceId = createDeviceId(event.device);
    const webUSBDevice = connectedDevicesMap.get(deviceId);
    if (webUSBDevice) {
      connectedDevicesMap.delete(deviceId);
      listener(webUSBDevice);
    }
  });
}

export async function getDevices(): Promise<WebUSBDevice[]> {
  debug('Getting devices');
  const nativeDevices = await ReactNativeUsbModule.getDevices();
  return nativeDevices.map((nativeDevice: NativeDevice) => {
    const deviceId = createDeviceId(nativeDevice);
    let webUSBDevice = connectedDevicesMap.get(deviceId);
    if (!webUSBDevice) {
      webUSBDevice = createWebUSBDevice(nativeDevice);
      connectedDevicesMap.set(deviceId, webUSBDevice);
    }
    return webUSBDevice;
  });
}

export function setPriorityMode(enabled: boolean): void {
  debug('Setting priority mode', enabled);
  ReactNativeUsbModule.setPriorityMode(enabled);
}

export class WebUSB {
  async getDevices(): Promise<WebUSBDevice[]> {
    return getDevices();
  }

  onconnect: ((event: { device: WebUSBDevice }) => void) | null = null;
  ondisconnect: ((event: { device: WebUSBDevice }) => void) | null = null;

  constructor() {
    onDeviceConnected((device) => {
      if (this.onconnect) {
        this.onconnect({ device });
      }
    });

    onDeviceDisconnect((device) => {
      if (this.ondisconnect) {
        this.ondisconnect({ device });
      }
    });
  }
}