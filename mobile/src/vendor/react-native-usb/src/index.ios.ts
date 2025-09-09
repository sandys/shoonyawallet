import { Subscription } from 'expo-modules-core';

import { WebUSBDevice } from './ReactNativeUsb.types';

// We don't support USB on iOS
export function onDeviceConnected(_listener: (device: WebUSBDevice) => void): Subscription {
  return {
    remove: () => {},
  };
}

export function onDeviceDisconnect(_listener: (device: WebUSBDevice) => void): Subscription {
  return {
    remove: () => {},
  };
}

export async function getDevices(): Promise<WebUSBDevice[]> {
  return [];
}

export function setPriorityMode(_enabled: boolean): void {
  // No-op
}

export class WebUSB {
  async getDevices(): Promise<WebUSBDevice[]> {
    return [];
  }

  onconnect: ((event: { device: WebUSBDevice }) => void) | null = null;
  ondisconnect: ((event: { device: WebUSBDevice }) => void) | null = null;
}