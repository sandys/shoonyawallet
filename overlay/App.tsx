import React, { useEffect, useMemo, useState } from 'react';
import { SafeAreaView, View, Text, Button, ActivityIndicator, StyleSheet, Platform } from 'react-native';
import { TrezorBridge } from './src/services/hardware/TrezorBridge';
import { SolanaRPCService } from './src/services/rpc/SolanaRPCService';

type Phase = 'idle' | 'connecting' | 'connected' | 'fetching' | 'done' | 'error';

export default function App() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [logs, setLogs] = useState<string[]>([]);
  const [pubkey, setPubkey] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const trezor = useMemo(() => new TrezorBridge((msg) => setLogs((l) => [...l, msg])), []);
  const rpc = useMemo(() => new SolanaRPCService(), []);

  const start = async () => {
    setLogs([]);
    setPhase('connecting');
    try {
      const key = await trezor.connectAndGetPublicKey({ maxAttempts: 3 });
      setPubkey(key);
      setPhase('fetching');
      const lamports = await rpc.getBalance(key);
      setBalance(lamports / 1_000_000_000);
      setPhase('done');
    } catch (e: any) {
      setLogs((l) => [...l, `Error: ${e?.message ?? String(e)}`]);
      setPhase('error');
    }
  };

  useEffect(() => {
    // Auto-start on Android; iOS shows unsupported note
    if (Platform.OS === 'android') {
      start();
    }
  }, []);

  return (
    <SafeAreaView style={styles.root}>
      <Text style={styles.title}>shoonyawallet</Text>
      {Platform.OS === 'ios' && (
        <Text style={styles.warn}>iOS: USB Trezor is not supported. Build is for UI/tests only.</Text>
      )}
      {phase !== 'done' && (
        <View style={styles.section}>
          <Text style={styles.subtitle}>Connect Trezor and Read Balance</Text>
          <ActivityIndicator size="large" />
          <Text style={styles.status}>Status: {phase}</Text>
          <View style={styles.btnrow}>
            <Button title="Start" onPress={start} />
            <Button title="Retry" onPress={start} />
          </View>
        </View>
      )}
      {phase === 'done' && (
        <View style={styles.section}>
          <Text style={styles.subtitle}>Public Key</Text>
          <Text selectable style={styles.mono}>{pubkey}</Text>
          <Text style={styles.subtitle}>SOL Balance</Text>
          <Text style={styles.value}>{balance?.toFixed(6)} SOL</Text>
          <Button title="Refresh" onPress={start} />
        </View>
      )}
      <View style={styles.logs}>
        {logs.slice(-8).map((l, i) => (
          <Text key={i} style={styles.logLine}>• {l}</Text>
        ))}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16, gap: 12 },
  title: { fontSize: 22, fontWeight: '700' },
  warn: { color: '#b36b00' },
  section: { gap: 8 },
  subtitle: { fontSize: 16, fontWeight: '600' },
  status: { color: '#666' },
  btnrow: { flexDirection: 'row', gap: 8 },
  mono: { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }), fontSize: 12 },
  value: { fontSize: 24, fontWeight: '700' },
  logs: { flex: 1, borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#ddd', paddingTop: 8 },
  logLine: { fontSize: 12, color: '#333' },
});

