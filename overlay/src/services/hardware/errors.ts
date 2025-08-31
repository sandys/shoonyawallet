export type TrezorErrorCode =
  | 'PERMISSION_DENIED'
  | 'DEVICE_NOT_FOUND'
  | 'DEVICE_BUSY'
  | 'CANCELLED'
  | 'TRANSPORT'
  | 'UNKNOWN';

export function classifyTrezorError(message: string): { code: TrezorErrorCode; retryable: boolean } {
  const msg = (message || '').toLowerCase();
  if (msg.includes('permission') || msg.includes('not granted') || msg.includes('denied')) {
    return { code: 'PERMISSION_DENIED', retryable: false };
  }
  if (msg.includes('no device') || msg.includes('device not found') || msg.includes('disconnected')) {
    return { code: 'DEVICE_NOT_FOUND', retryable: true };
  }
  if (msg.includes('busy') || msg.includes('in use')) {
    return { code: 'DEVICE_BUSY', retryable: true };
  }
  if (msg.includes('cancelled') || msg.includes('canceled') || msg.includes('abort')) {
    return { code: 'CANCELLED', retryable: false };
  }
  if (msg.includes('transport') || msg.includes('usb') || msg.includes('hid') || msg.includes('timeout')) {
    return { code: 'TRANSPORT', retryable: true };
  }
  return { code: 'UNKNOWN', retryable: true };
}

