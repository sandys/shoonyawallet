// Complete rewrite using only official @trezor libraries

import { Messages, parseConfigure, encodeMessage, decodeMessage, loadDefinitions } from '@trezor/protobuf';
import * as protocol from '@trezor/protocol';

const MESSAGES = parseConfigure(Messages);

// Load Trezor message definitions from generated descriptor
try {
  const descriptor = require('./protos/descriptor.json');
  const messagesPkg = descriptor?.nested?.hw?.nested?.trezor?.nested?.messages;
  if (messagesPkg) {
    console.log('Loading Trezor message definitions...');
    loadDefinitions(MESSAGES, 'hw.trezor.messages', async () => messagesPkg);
    console.log('Loaded message definitions');
  } else {
    console.log('No message definitions found in descriptor');
  }
} catch (e) {
  console.log('Failed to load message definitions:', e);
}

function toNodeBuffer(u8: Uint8Array): Buffer {
  const { Buffer } = require('buffer');
  return Buffer.from(u8);
}

type ExchangeFn = (bytes: number[], timeout: number) => Promise<number[]>;

export async function sendAndReceive(
  exchange: ExchangeFn,
  messageName: string,
  messageData: Record<string, unknown>,
  timeoutMs = 2000,
): Promise<{ type: string; message: any }> {
  
  // Encode using official protobuf
  const { messageType, message } = encodeMessage(MESSAGES, messageName, messageData);
  const encoded = protocol.v1.encode(message, { messageType });
  
  // Send message in 64-byte chunks
  const chunkSize = 64;
  for (let i = 0; i < encoded.length; i += chunkSize) {
    const chunk = Array.from(encoded.slice(i, i + chunkSize));
    // Pad to 64 bytes with zeros
    while (chunk.length < chunkSize) chunk.push(0);
    await exchange(chunk, timeoutMs);
  }
  
  // Receive and parse response
  let receivedBuffer = Buffer.alloc(0);
  const started = Date.now();
  
  while (Date.now() - started < timeoutMs + 50) {
    const remain = Math.max(1, timeoutMs - (Date.now() - started));
    try {
      const part = await exchange([], remain);
      if (part && part.length > 0) {
        receivedBuffer = Buffer.concat([receivedBuffer, toNodeBuffer(new Uint8Array(part))]);
        
        // Try to decode complete message
        try {
          const decoded = protocol.v1.decode(receivedBuffer);
          if (decoded.messageType !== undefined && decoded.payload) {
            // Parse the protobuf message
            const { type, message } = decodeMessage(MESSAGES, decoded.messageType, decoded.payload);
            console.log(`Received message type: ${type}`);
            return { type, message };
          }
        } catch (parseError) {
          // Continue reading if message incomplete
        }
      }
    } catch {
      await new Promise(r => setTimeout(r, 50));
    }
  }
  
  // Final parse attempt
  try {
    const decoded = protocol.v1.decode(receivedBuffer);
    const { type, message } = decodeMessage(MESSAGES, decoded.messageType, decoded.payload);
    return { type, message };
  } catch {
    throw new Error('Failed to parse response message');
  }
}

export function encodeByName(name: string, data: any): { msgType: number; payload: Uint8Array } {
  try {
    const { messageType, message } = encodeMessage(MESSAGES, name, data);
    return { msgType: messageType as number, payload: new Uint8Array(message) };
  } catch (_) {
    return { msgType: 0, payload: new Uint8Array() };
  }
}

export function decodeToObject(msgType: number, payload: Uint8Array): { type: string; message: any } | null {
  try {
    const { type, message } = decodeMessage(MESSAGES, msgType, toNodeBuffer(payload));
    return { type, message };
  } catch (_) {
    return null;
  }
}

export { MESSAGES };