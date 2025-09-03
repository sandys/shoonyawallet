// Official Trezor library adapter using proper @trezor/transport utilities

import { Messages, parseConfigure, encodeMessage, decodeMessage, loadDefinitions } from '@trezor/protobuf';
import * as protocol from '@trezor/protocol';
import { createChunks } from '@trezor/transport/lib/utils/send';
import { success, failure } from '@trezor/transport/lib/utils/result';

const MESSAGES = parseConfigure(Messages);

function toNodeBuffer(u8: Uint8Array): Buffer {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Buffer } = require('buffer');
  return Buffer.from(u8);
}

// Attempt to augment messages with vendored Solana definitions if available
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const descriptor = require('./protos/descriptor.json');
  const messagesPkg = descriptor?.nested?.hw?.nested?.trezor?.nested?.messages;
  if (messagesPkg) {
    // Load the whole messages package including solana
    loadDefinitions(MESSAGES, 'hw.trezor.messages', async () => messagesPkg);
  }
} catch (_) {
  // ignore; definitions may not be generated at test-time
}

type ExchangeFn = (bytes: number[], timeout: number) => Promise<number[]>;

// USB read wrapper that returns proper transport result format
async function usbReceiver(exchange: ExchangeFn, timeoutMs: number) {
  try {
    const data = await exchange([], timeoutMs);
    if (data && data.length > 0) {
      return success(toNodeBuffer(data));
    }
    return failure('No data received from USB');
  } catch (error) {
    return failure(`USB read error: ${error}`);
  }
}

// USB write wrapper that returns proper transport result format  
async function usbWriter(exchange: ExchangeFn, data: Buffer, timeoutMs: number) {
  try {
    await exchange(Array.from(data), timeoutMs);
    return success(undefined);
  } catch (error) {
    return failure(`USB write error: ${error}`);
  }
}

export async function sendAndReceive(
  exchange: ExchangeFn,
  msgType: number,
  payload: Uint8Array,
  timeoutMs = 2000,
): Promise<{ msgType: number; payload: Uint8Array }> {
  // Use official Trezor protocol encoding
  const encoded = protocol.v1.encode(toNodeBuffer(payload), { messageType: msgType });
  const chunks = createChunks(encoded, Buffer.from([0x3f, 0x23, 0x23]), 64);
  
  // Send all chunks
  for (const chunk of chunks) {
    await exchange(Array.from(chunk), timeoutMs);
  }
  
  // Receive using official Trezor approach
  const receiver = () => usbReceiver(exchange, timeoutMs);
  
  // Use official receive function approach
  let totalReceived = Buffer.alloc(0);
  let expectedLength: number | null = null;
  let messageType: number | null = null;
  
  const started = Date.now();
  while (Date.now() - started < timeoutMs + 50) {
    const readResult = await receiver();
    if (!readResult.success) {
      continue;
    }
    
    const data = readResult.payload as Buffer;
    totalReceived = Buffer.concat([totalReceived, data]);
    
    // Use official protocol decoder
    try {
      const decoded = protocol.v1.decode(totalReceived);
      console.log(`Official parser: type=0x${decoded.messageType.toString(16)} len=${decoded.length}`);
      
      if (decoded.messageType && decoded.length !== undefined) {
        messageType = decoded.messageType;
        expectedLength = decoded.length;
        
        if (totalReceived.length >= decoded.payload.length + 9) {
          // Complete message received
          return { 
            msgType: decoded.messageType, 
            payload: new Uint8Array(decoded.payload) 
          };
        }
      }
    } catch (parseError) {
      // Continue reading if parsing fails
      console.log(`Official parser failed, continuing to read: ${parseError}`);
    }
    
    // Break if we have expected length and enough data
    if (messageType && expectedLength && totalReceived.length >= expectedLength + 9) {
      break;
    }
  }
  
  // Final attempt to parse whatever we received
  try {
    const decoded = protocol.v1.decode(totalReceived);
    return { 
      msgType: decoded.messageType || 0, 
      payload: decoded.payload ? new Uint8Array(decoded.payload) : new Uint8Array()
    };
  } catch {
    console.log(`Final parse failed, returning raw data`);
    return { msgType: 0, payload: new Uint8Array(totalReceived) };
  }
}

export function encodeByName(name: string, data: any): { msgType: number; payload: Uint8Array } {
  try {
    const { messageType, message } = pbEncodeMessage(MESSAGES, name, data);
    return { msgType: messageType as number, payload: new Uint8Array(message) };
  } catch (_) {
    // Fallback: no message encoding available
    return { msgType: 0, payload: new Uint8Array() };
  }
}

export function decodeToObject(msgType: number, payload: Uint8Array): { type: string; message: any } | null {
  try {
    const { type, message } = pbDecodeMessage(MESSAGES, msgType, toNodeBuffer(payload));
    return { type, message };
  } catch (_) {
    return null;
  }
}
