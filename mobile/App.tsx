import React, { useCallback, useRef, useState } from 'react';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, Button, ActivityIndicator, StyleSheet, Platform, Modal, ScrollView, Pressable } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import type { WebViewMessageEvent } from 'react-native-webview';
import { WebView } from 'react-native-webview';

type Phase = 'idle' | 'connecting' | 'ready' | 'error';

type BridgeRequest = { id: number; action: string; payload?: any };
type BridgeResponse =
  | { id: number; status: 'success'; result: any }
  | { id: number; status: 'error'; error: string };

export default function App() {
  const [phase, setPhase] = useState<Phase>('idle');
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [ethAddress, setEthAddress] = useState<string | null>(null);
  const [showPermissionHelp, setShowPermissionHelp] = useState(false);
  const [webviewReady, setWebviewReady] = useState(false);

  const webviewRef = useRef<WebView>(null);
  const reqId = useRef(1);
  const pending = useRef(new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>());

  const log = useCallback((msg: string) => {
    const ts = new Date().toISOString().slice(11, 23);
    setLogs((l) => [...l, `${ts} ${msg}`].slice(-500));
  }, []);

  const sendToBridge = useCallback(async (action: string, payload?: any) => {
    return new Promise<any>((resolve, reject) => {
      const id = reqId.current++;
      pending.current.set(id, { resolve, reject });
      const message: BridgeRequest = { id, action, payload };
      try {
        webviewRef.current?.postMessage(JSON.stringify(message));
        log(`RN->WV ${action}`);
      } catch (e) {
        pending.current.delete(id);
        reject(e);
      }
    });
  }, [log]);

  const onWebViewMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const data: BridgeResponse = JSON.parse(event.nativeEvent.data);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyData: any = data as any;
      if (typeof anyData.id !== 'number') {
        log(`WV->RN unknown message: ${event.nativeEvent.data.slice(0, 120)}`);
        return;
      }
      const cb = pending.current.get(anyData.id);
      if (!cb) return;
      pending.current.delete(anyData.id);
      if (anyData.status === 'success') {
        log(`WV->RN OK for id ${anyData.id}`);
        cb.resolve(anyData.result);
      } else {
        log(`WV->RN ERR for id ${anyData.id}: ${anyData.error}`);
        cb.reject(new Error(anyData.error || 'Bridge error'));
      }
    } catch (e) {
      log(`WV->RN parse error: ${String(e)}`);
    }
  }, [log]);

  const start = async () => {
    setLogs([]);
    setError(null);
    setPhase('connecting');
    try {
      if (!webviewReady) {
        await new Promise((r) => setTimeout(r, 500));
      }
      const res = await sendToBridge('eth_getAddress', {
        path: "m/44'/60'/0'/0/0",
        showOnTrezor: true,
      });
      const address: string | undefined = res?.payload?.address || res?.address || res?.payload?.addressHex;
      if (!address) throw new Error('No address returned');
      setEthAddress(address);
      setPhase('ready');
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setError(msg);
      setPhase('error');
      setShowPermissionHelp(true);
    }
  };

  const signSampleTx = async () => {
    try {
      setError(null);
      log('Signing sample EIP-1559 tx on chainId 1 (not broadcast)');
      const result = await sendToBridge('eth_signTransaction', {
        path: "m/44'/60'/0'/0/0",
        transaction: {
          chainId: 1,
          to: '0x000000000000000000000000000000000000dead',
          value: '0x16345785d8a0000',
          nonce: '0x0',
          maxFeePerGas: '0x59682f00',
          maxPriorityFeePerGas: '0x3b9aca00',
          gasLimit: '0x5208',
          data: '0x',
        },
      });
      const sig = result?.payload || result;
      log(`Signature: ${JSON.stringify(sig)}`);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        <Text style={styles.title}>sifar</Text>
        {Platform.OS === 'ios' && (
          <Text style={styles.warn}>iOS is not supported for WebUSB/Trezor.</Text>
        )}
        <View style={styles.section}>
          <Text style={styles.subtitle}>Trezor via WebView + Trezor Connect</Text>
          <ActivityIndicator size="small" />
          <Text style={styles.status}>Status: {phase}</Text>
          <Text style={styles.help}>
            Connect your Trezor via USB-OTG. Grant USB access if prompted.
          </Text>
          <View style={styles.btnrow}>
            <Button accessibilityLabel="get-eth-address" title="Get ETH Address" onPress={() => start()} />
            <Button accessibilityLabel="sign-sample-tx" title="Sign Sample Tx" onPress={() => signSampleTx()} />
            {(global as any).__TEST__ ? (
              <>
                <Pressable testID="btnGetAddress" onPress={() => start()} accessibilityRole="button">
                  <Text style={styles.mono}>[TEST] Get ETH Address</Text>
                </Pressable>
                <Pressable testID="btnSignSample" onPress={() => signSampleTx()} accessibilityRole="button">
                  <Text style={styles.mono}>[TEST] Sign Sample Tx</Text>
                </Pressable>
              </>
            ) : null}
          </View>
          {!!error && (
            <Text style={styles.error}>Error: {error}</Text>
          )}
          {!!ethAddress && (
            <>
              <Text style={styles.subtitle}>ETH Address</Text>
              <Text selectable style={styles.mono}>{ethAddress}</Text>
            </>
          )}
        </View>
        <View style={styles.logs}>
          <Text style={styles.subtitle}>Logs</Text>
          <ScrollView style={styles.logScroll} contentContainerStyle={styles.logContent}>
            {logs.map((l, i) => (
              <Text key={i} style={styles.logLine}>{l}</Text>
            ))}
          </ScrollView>
          <View style={styles.btnrow}>
            <Button title="Copy Logs" onPress={async () => {
              try {
                const merged = [...logs];
                Clipboard.setString(merged.join('\n'));
                const ts = new Date().toISOString().slice(11, 23);
                setLogs((l) => [...l, `${ts} Copied ${merged.length} lines to clipboard`]);
              } catch (e) {
                const ts = new Date().toISOString().slice(11, 23);
                setLogs((l) => [...l, `${ts} Copy failed: ${String(e)}`]);
              }
            }} />
            <Button title="Clear Logs" onPress={() => setLogs([])} />
          </View>
        </View>

        <Modal visible={showPermissionHelp} animationType="slide" transparent>
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <Text style={styles.subtitle}>Grant USB Permission</Text>
              <Text style={styles.help}>1. Connect Trezor via USB-OTG.</Text>
              <Text style={styles.help}>2. Unlock device and keep it on home screen.</Text>
              <Text style={styles.help}>3. When Android prompts for USB access, tap Allow (optionally Always).</Text>
              <Text style={styles.help}>4. If no prompt, unplug/replug or enable OTG in settings.</Text>
              <View style={styles.btnrow}>
                <Button title="Close" onPress={() => setShowPermissionHelp(false)} />
                <Button title="Try Again" onPress={() => { setShowPermissionHelp(false); start(); }} />
              </View>
            </View>
          </View>
        </Modal>

        {/* Hidden WebView bridge for Trezor Connect (WebUSB). Rendered always to ease testing. */}
        <WebView
          ref={webviewRef}
          onLoadEnd={() => { setWebviewReady(true); log('WebView ready'); }}
          onMessage={onWebViewMessage}
          originWhitelist={['*']}
          javaScriptEnabled
          domStorageEnabled
          automaticallyAdjustContentInsets={false}
          source={{ html: trezorBridgeHtmlContent }}
          style={{ width: 1, height: 1, opacity: 0 }}
        />
      </SafeAreaView>
    </SafeAreaProvider>
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
  logs: { flex: 1, borderTopWidth: StyleSheet.hairlineWidth, borderColor: '#ddd', paddingTop: 8 },
  logScroll: { flex: 1 },
  logContent: { paddingBottom: 16 },
  logLine: { fontSize: 12, color: '#333', fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }) },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  modalCard: { backgroundColor: 'white', padding: 16, borderRadius: 8, width: '92%', gap: 8 },
});

// Minimal HTML payload that loads Trezor Connect from CDN and bridges postMessage
const trezorBridgeHtmlContent = `<!doctype html>
<html>
  <head>
    <meta charset=\"utf-8\" />
    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
    <title>Trezor Bridge</title>
    <script src=\"https://connect.trezor.io/9/trezor-connect.js\"></script>
    <script>
      (function() {
        function log(msg) { try { console.log('[WV]', msg); } catch (e) {} }

        async function init() {
          try {
            await TrezorConnect.init({
              connectSrc: 'https://connect.trezor.io/9/',
              manifest: { email: 'support@nullwallet.app', appUrl: 'https://nullwallet.app' },
              lazyLoad: true,
              transportReconnect: true,
            });
            log('TrezorConnect initialized');
          } catch (e) {
            log('Init error: ' + (e && e.message ? e.message : e));
          }
        }

        function postMessageToRN(obj) {
          try { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(obj)); } catch (e) {}
        }

        function handleMessage(raw) {
          var data; try { data = JSON.parse(raw && raw.data ? raw.data : raw); } catch (e) { return; }
          var id = data && data.id; var action = data && data.action; var payload = data && data.payload;
          if (typeof id !== 'number' || !action) return;
          (async function(){
            try {
              var result;
              switch(action) {
                case 'eth_getAddress':
                  result = await TrezorConnect.ethereumGetAddress({
                    path: (payload && payload.path) || "m/44'\/60'\/0'\/0\/0",
                    showOnTrezor: !!(payload && payload.showOnTrezor)
                  });
                  break;
                case 'eth_signTransaction':
                  result = await TrezorConnect.ethereumSignTransaction({
                    path: payload && payload.path,
                    transaction: payload && payload.transaction,
                  });
                  break;
                case 'getPublicKey':
                  result = await TrezorConnect.getPublicKey({ path: (payload && payload.path) || "m/44'\/60'\/0'" });
                  break;
                case 'getFeatures':
                  result = await TrezorConnect.getFeatures();
                  break;
                default:
                  throw new Error('Unsupported action: ' + action);
              }
              postMessageToRN({ id: id, status: 'success', result: result });
            } catch (e) {
              postMessageToRN({ id: id, status: 'error', error: (e && e.message) ? e.message : String(e) });
            }
          })();
        }

        window.addEventListener('message', handleMessage);
        document.addEventListener('message', handleMessage);
        init();
      })();
    </script>
    <style> body { background: #fff; } </style>
  </head>
  <body>
    <div id=\"app\">Trezor Bridge Ready</div>
  </body>
  </html>`;
