import { useState, useCallback } from 'react';
import { TrezorBridge } from '../services/hardware/TrezorBridge';

export interface TrezorState {
  isConnected: boolean;
  publicKey: string | null;
  isConnecting: boolean;
  logs: string[];
  passphraseRequired: boolean;
}

export const useTrezor = () => {
  const [state, setState] = useState<TrezorState>({
    isConnected: false,
    publicKey: null,
    isConnecting: false,
    logs: [],
    passphraseRequired: false,
  });

  const [passphraseResolver, setPassphraseResolver] = useState<{
    resolve: (passphrase: string | null) => void;
  } | null>(null);

  const addLog = useCallback((message: string) => {
    setState(prev => ({
      ...prev,
      logs: [...prev.logs.slice(-50), message] // Keep last 50 log entries
    }));
  }, []);

  const passphraseProvider = useCallback(async (): Promise<string | null> => {
    return new Promise((resolve) => {
      setState(prev => ({ ...prev, passphraseRequired: true }));
      setPassphraseResolver({ resolve });
    });
  }, []);

  const submitPassphrase = useCallback((passphrase: string) => {
    if (passphraseResolver) {
      passphraseResolver.resolve(passphrase);
      setPassphraseResolver(null);
      setState(prev => ({ ...prev, passphraseRequired: false }));
    }
  }, [passphraseResolver]);

  const cancelPassphrase = useCallback(() => {
    if (passphraseResolver) {
      passphraseResolver.resolve(null);
      setPassphraseResolver(null);
      setState(prev => ({ ...prev, passphraseRequired: false }));
    }
  }, [passphraseResolver]);

  const connect = useCallback(async () => {
    setState(prev => ({ 
      ...prev, 
      isConnecting: true, 
      logs: [],
      isConnected: false,
      publicKey: null
    }));

    try {
      const bridge = new TrezorBridge(addLog, passphraseProvider);
      const publicKey = await bridge.connectAndGetPublicKey({
        maxAttempts: 3,
        attemptDelayMs: 2000,
        backoff: 'exponential',
        maxDelayMs: 10000,
        waitForPresenceMs: 30000,
        presencePollMs: 1000,
        presenceStableCount: 2,
      });

      setState(prev => ({
        ...prev,
        isConnected: true,
        publicKey,
        isConnecting: false,
      }));

      return publicKey;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      addLog(`Connection failed: ${errorMessage}`);
      setState(prev => ({
        ...prev,
        isConnecting: false,
        isConnected: false,
      }));
      throw error;
    }
  }, [addLog, passphraseProvider]);

  const disconnect = useCallback(() => {
    setState({
      isConnected: false,
      publicKey: null,
      isConnecting: false,
      logs: [],
      passphraseRequired: false,
    });
    setPassphraseResolver(null);
  }, []);

  return {
    ...state,
    connect,
    disconnect,
    submitPassphrase,
    cancelPassphrase,
  };
};