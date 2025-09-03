import { Messages, parseConfigure } from '@trezor/protobuf';

describe('Protobuf descriptors and message definitions', () => {
  let descriptor: any;
  let MESSAGES: any;

  beforeAll(() => {
    // Load the generated descriptor
    descriptor = require('../src/services/hardware/trezor/protos/descriptor.json');
    MESSAGES = parseConfigure(Messages);
  });

  test('descriptor.json exists and is valid', () => {
    expect(descriptor).toBeDefined();
    expect(typeof descriptor).toBe('object');
    expect(descriptor.nested).toBeDefined();
  });

  test('descriptor contains hw.trezor.messages package', () => {
    const messagesPkg = descriptor?.nested?.hw?.nested?.trezor?.nested?.messages;
    expect(messagesPkg).toBeDefined();
    expect(typeof messagesPkg).toBe('object');
  });

  test('descriptor contains required Trezor message types', () => {
    const messages = descriptor?.nested?.hw?.nested?.trezor?.nested?.messages?.nested;
    
    // Check common messages
    const common = messages?.common?.nested;
    expect(common?.Success).toBeDefined();
    expect(common?.Failure).toBeDefined();
    expect(common?.PassphraseRequest).toBeDefined();
    expect(common?.PassphraseAck).toBeDefined();
    
    // Check management messages
    const management = messages?.management?.nested;
    expect(management?.Initialize).toBeDefined();
    expect(management?.Features).toBeDefined();
    expect(management?.Ping).toBeDefined();
    
    // Check Solana-specific messages
    const solana = messages?.solana?.nested;
    expect(solana?.SolanaGetPublicKey).toBeDefined();
    expect(solana?.SolanaPublicKey).toBeDefined();
    expect(solana?.SolanaGetAddress).toBeDefined();
    expect(solana?.SolanaAddress).toBeDefined();
    expect(solana?.SolanaSignTx).toBeDefined();
    expect(solana?.SolanaTxSignature).toBeDefined();
  });

  test('message definitions have correct structure', () => {
    const messages = descriptor?.nested?.hw?.nested?.trezor?.nested?.messages?.nested;
    
    // Check Initialize message structure
    const initialize = messages?.management?.nested?.Initialize;
    expect(initialize?.fields).toBeDefined();
    
    // Check PassphraseRequest structure
    const passphraseRequest = messages?.common?.nested?.PassphraseRequest;
    expect(passphraseRequest?.fields).toBeDefined();
    
    // Check SolanaGetPublicKey structure
    const solanaGetPubKey = messages?.solana?.nested?.SolanaGetPublicKey;
    expect(solanaGetPubKey?.fields).toBeDefined();
    expect(solanaGetPubKey?.fields?.addressN).toBeDefined();
  });

  test('proto files contain expected message definitions', () => {
    const fs = require('fs');
    const path = require('path');
    
    const protoDir = path.join(__dirname, '../src/services/hardware/trezor/protos');
    
    // Check that required proto files exist
    expect(fs.existsSync(path.join(protoDir, 'messages.proto'))).toBe(true);
    expect(fs.existsSync(path.join(protoDir, 'messages-common.proto'))).toBe(true);
    expect(fs.existsSync(path.join(protoDir, 'messages-management.proto'))).toBe(true);
    expect(fs.existsSync(path.join(protoDir, 'messages-solana.proto'))).toBe(true);
    expect(fs.existsSync(path.join(protoDir, 'options.proto'))).toBe(true);
    
    // Check messages-solana.proto contains expected content
    const solanProtoContent = fs.readFileSync(path.join(protoDir, 'messages-solana.proto'), 'utf8');
    expect(solanProtoContent).toContain('message SolanaGetPublicKey');
    expect(solanProtoContent).toContain('message SolanaPublicKey');
    expect(solanProtoContent).toContain('message SolanaSignTx');
  });

  test('parseConfigure works with Messages', () => {
    expect(MESSAGES).toBeDefined();
    expect(typeof MESSAGES).toBe('object');
  });
});