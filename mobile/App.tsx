import React, { useEffect, useMemo, useState } from 'react';
import { SafeAreaView, View, Text, Button, ActivityIndicator, StyleSheet, Platform, Modal, ScrollView } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { TrezorBridge } from './src/services/hardware/TrezorBridge';
import { TrezorUSB } from './src/native/TrezorUSB';
import { SolanaRPCService } from './src/services/rpc/SolanaRPCService';
import { classifyTrezorError } from './src/services/hardware/errors';

type Phase = 'idle' | 'connecting' | 'fetching' | 'done' | 'error';

export default function App() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pubkey, setPubkey] = useState<string | null>(null);
  const [balance, setBalance] = useState<number | null>(null);
  const [showPermissionHelp, setShowPermissionHelp] = useState(false);
  const trezor = useMemo(() => new TrezorBridge((msg) => {
    const ts = new Date().toISOString().slice(11, 23);
    setLogs((l) => [...l, `${ts} ${msg}`].slice(-500));
  }), []);
  const rpc = useMemo(() => new SolanaRPCService(), []);

  const pullNativeLogs = async () => {
    try {
      const native = await TrezorUSB.getDebugLog();
      const count = Array.isArray(native) ? native.length : 0;
      if (count > 0) {
        setLogs((l) => [...l, ...native, `${new Date().toISOString().slice(11, 23)} Pulled ${count} native log lines`]);
      } else {
        setLogs((l) => [...l, `${new Date().toISOString().slice(11, 23)} No native logs available`]);
      }
    } catch (e) {
      const ts = new Date().toISOString().slice(11, 23);
      setLogs((l) => [...l, `${ts} Failed to pull native logs: ${String(e)}`]);
    }
  };

  const start = async (opts?: { slow?: boolean }) => {
    setLogs([]);
    setError(null);
    setPhase('connecting');
    try {
      const key = await trezor.connectAndGetPublicKey(
        opts?.slow
          ? { maxAttempts: 5, attemptDelayMs: 1200, backoff: 'exponential', maxDelayMs: 8000 }
          : { maxAttempts: 3, attemptDelayMs: 600, backoff: 'linear' }
      );
      setPubkey(key);
      setPhase('fetching');
      const lamports = await rpc.getBalance(key);
      setBalance(lamports / 1_000_000_000);
      setPhase('done');
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setLogs((l) => [...l, `Error: ${msg}`]);
      setError(msg);
      const cls = classifyTrezorError(msg);
      if (cls.code === 'PERMISSION_DENIED' || cls.code === 'DEVICE_NOT_FOUND') {
        setShowPermissionHelp(true);
      }
      // Pull native logs to aid debugging
      await pullNativeLogs();
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
          <Text style={styles.help}>
            Ensure Trezor Safe 3 is connected via USB-OTG and unlocked. On Android, grant USB permission when prompted.
          </Text>
          <View style={styles.btnrow}>
            <Button title="Start" onPress={() => start()} />
            <Button title="Retry" onPress={() => start()} />
            <Button title="Slow Retry" onPress={() => start({ slow: true })} />
          </View>
          {phase === 'error' && !!error && (
            <Text style={styles.error}>Error: {error}</Text>
          )}
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
        <Text style={styles.subtitle}>Logs</Text>
        <ScrollView style={styles.logScroll} contentContainerStyle={styles.logContent}>
          {logs.map((l, i) => (
            <Text key={i} style={styles.logLine}>{l}</Text>
          ))}
        </ScrollView>
        <View style={styles.btnrow}>
          <Button title="Copy Logs" onPress={() => {
            try {
              Clipboard.setString(logs.join('\n'));
              const ts = new Date().toISOString().slice(11, 23);
              setLogs((l) => [...l, `${ts} Copied ${l.length} lines to clipboard`]);
            } catch (e) {
              const ts = new Date().toISOString().slice(11, 23);
              setLogs((l) => [...l, `${ts} Copy failed: ${String(e)}`]);
            }
          }} />
          <Button title="Clear Logs" onPress={() => setLogs([])} />
          {Platform.OS === 'android' && (
            <>
              <Button title="Pull Native Logs" onPress={pullNativeLogs} />
              <Button title="Clear Native Logs" onPress={async () => {
                try {
                  await TrezorUSB.clearDebugLog();
                  const ts = new Date().toISOString().slice(11, 23);
                  setLogs((l) => [...l, `${ts} Cleared native log buffer`]);
                } catch (e) {
                  const ts = new Date().toISOString().slice(11, 23);
                  setLogs((l) => [...l, `${ts} Failed to clear native logs: ${String(e)}`]);
                }
              }} />
            </>
          )}
        </View>
      </View>
      <Modal visible={showPermissionHelp} animationType="slide" transparent>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.subtitle}>Grant USB Permission</Text>
            <Text style={styles.help}>1. Connect Trezor Safe 3 via USB-OTG.</Text>
            <Text style={styles.help}>2. Unlock device and keep it on home screen.</Text>
            <Text style={styles.help}>3. When Android prompts for USB access, tap Allow (optionally Always).</Text>
            <Text style={styles.help}>4. If no prompt, unplug/replug or enable OTG in settings.</Text>
            <View style={styles.btnrow}>
              <Button title="Close" onPress={() => setShowPermissionHelp(false)} />
              <Button title="Try Again (Slow)" onPress={() => { setShowPermissionHelp(false); start({ slow: true }); }} />
            </View>
          </View>
        </View>
      </Modal>
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
  help: { color: '#555' },
  error: { color: '#b00020' },
  btnrow: { flexDirection: 'row', gap: 8 },
  mono: { fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }), fontSize: 12 },
  value: { fontSize: 24, fontWeight: '700' },
  logs: { flex: 1, borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#ddd', paddingTop: 8 },
  logScroll: { flex: 1 },
  logContent: { paddingBottom: 16 },
  logLine: { fontSize: 12, color: '#333', fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }) },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  modalCard: { backgroundColor: 'white', padding: 16, borderRadius: 8, width: '92%', gap: 8 },
});
