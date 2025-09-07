import React, { useCallback, useEffect, useRef, useState } from 'react';
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
  const readyWaiters = useRef<Array<() => void>>([]);

  const webviewRef = useRef<WebView>(null);
  const reqId = useRef(1);
  const pending = useRef(new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>());

  const MAX_LOGS = 2000;
  const log = useCallback((msg: string) => {
    const ts = new Date().toISOString();
    setLogs((l) => [...l, `${ts} ${msg}`].slice(-MAX_LOGS));
  }, []);
  const logInfo = useCallback((msg: string) => log(`[INFO] ${msg}`), [log]);
  const logWarn = useCallback((msg: string) => log(`[WARN] ${msg}`), [log]);
  const logError = useCallback((msg: string) => log(`[ERROR] ${msg}`), [log]);

  const sendToBridge = useCallback(async (action: string, payload?: any) => {
    if (!webviewReady) {
      logInfo(`Bridge not ready; waiting before sending ${action}`);
      await new Promise<void>((resolve) => readyWaiters.current.push(resolve));
    }
    return new Promise<any>((resolve, reject) => {
      const id = reqId.current++;
      pending.current.set(id, { resolve, reject });
      const message: BridgeRequest = { id, action, payload };
      try {
        const summary = action === 'eth_signTransaction'
          ? `{to:${payload?.transaction?.to}, value:${payload?.transaction?.value}, chainId:${payload?.transaction?.chainId}}`
          : JSON.stringify(payload ?? {});
        logInfo(`RN->WV id=${id} action=${action} payload=${summary}`);
        webviewRef.current?.postMessage(JSON.stringify(message));
      } catch (e: any) {
        pending.current.delete(id);
        const msg = e?.message ?? String(e);
        logError(`Failed to postMessage id=${id}: ${msg}`);
        reject(e);
      }
    });
  }, [logInfo, logError, webviewReady]);

  const onWebViewMessage = useCallback((event: WebViewMessageEvent) => {
    try {
      const data: any = JSON.parse(event.nativeEvent.data);
      if (data && data.type === 'log') {
        const level = (data.level || 'log').toUpperCase();
        const message = data.message || '';
        // Tag logs from within WebView
        log(`[WV ${level}] ${message}`);
        return;
      }
      const anyData: any = data as any;
      if (typeof anyData.id !== 'number') {
        logWarn(`WV->RN unknown message: ${event.nativeEvent.data.slice(0, 200)}`);
        return;
      }
      const cb = pending.current.get(anyData.id);
      if (!cb) return;
      pending.current.delete(anyData.id);
      if (anyData.status === 'success') {
        logInfo(`WV->RN OK id=${anyData.id}`);
        cb.resolve(anyData.result);
      } else {
        logError(`WV->RN ERR id=${anyData.id}: ${anyData.error}`);
        cb.reject(new Error(anyData.error || 'Bridge error'));
      }
    } catch (e) {
      logError(`WV->RN parse error: ${String(e)}`);
    }
  }, [log, logInfo, logWarn, logError]);

  const start = async () => {
    logInfo('start() called');
    setLogs([]);
    setError(null);
    setPhase('connecting');
    try {
      if (!webviewReady) logInfo('Waiting for WebView to be ready…');
      const res = await sendToBridge('eth_getAddress', {
        path: "m/44'/60'/0'/0/0",
        showOnTrezor: true,
      });
      const address: string | undefined = res?.payload?.address || res?.address || res?.payload?.addressHex;
      if (!address) throw new Error('No address returned');
      setEthAddress(address);
      logInfo(`Received ETH address: ${address}`);
      setPhase('ready');
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setError(msg);
      logError(`start() failed: ${msg}`);
      setPhase('error');
      setShowPermissionHelp(true);
    }
  };

  const signSampleTx = async () => {
    try {
      setError(null);
      logInfo('Signing sample EIP-1559 tx on chainId 1 (not broadcast)');
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
      logInfo(`Signature: ${JSON.stringify(sig)}`);
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      setError(msg);
      logError(`signSampleTx failed: ${msg}`);
    }
  };

  useEffect(() => {
    log(`App mounted (${Platform.OS})`);
  }, [log]);

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
                const header = [
                  `App: sifar`,
                  `Platform: ${Platform.OS} ${String(Platform.Version)}`,
                  `Phase: ${phase}`,
                  `WebView ready: ${webviewReady}`,
                  `Pending requests: ${pending.current.size}`,
                  `Next reqId: ${reqId.current}`,
                  `ETH addr: ${ethAddress ?? '-'}`,
                  '=== Logs start ===',
                ];
                const merged = [...header, ...logs];
                Clipboard.setString(merged.join('\n'));
                const ts = new Date().toISOString().slice(11, 23);
                setLogs((l) => [...l, `${ts} Copied ${merged.length} lines to clipboard`]);
              } catch (e) {
                const ts = new Date().toISOString().slice(11, 23);
                setLogs((l) => [...l, `${ts} Copy failed: ${String(e)}`]);
              }
            }} />
            <Button title="Clear Logs" onPress={() => setLogs([])} />
            <Button title="Dump State" onPress={() => {
              logInfo(`Dump: phase=${phase} webviewReady=${webviewReady} pending=${pending.current.size} reqId=${reqId.current} addr=${ethAddress}`);
            }} />
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
          onLoadStart={() => { logInfo('WebView load start'); }}
          onLoadEnd={() => {
            setWebviewReady(true);
            const q = readyWaiters.current.splice(0, readyWaiters.current.length);
            q.forEach((fn) => fn());
            logInfo('WebView ready');
          }}
          onError={(syntheticEvent) => {
            const { nativeEvent } = syntheticEvent as any;
            logError(`WebView error: ${nativeEvent?.description || nativeEvent}`);
          }}
          onHttpError={(syntheticEvent) => {
            const { nativeEvent } = syntheticEvent as any;
            logError(`WebView HTTP ${nativeEvent?.statusCode}: ${nativeEvent?.description || ''}`);
          }}
          onNavigationStateChange={(navState) => { try { logInfo(`WebView nav: ${navState.url || '(inline)'} loading=${navState.loading}`);} catch(_){} }}
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
        var RN = window.ReactNativeWebView;
        function bridgeLog(level, msg) {
          try { RN && RN.postMessage(JSON.stringify({ type: 'log', level: level, message: String(msg) })); } catch (e) {}
        }
        // Mirror console to RN
        (function(){
          var c = window.console || {};
          ['log','warn','error','info','debug'].forEach(function(k){
            var orig = c[k] ? c[k].bind(c) : function(){};
            console[k] = function(){
              try {
                var msg = Array.prototype.map.call(arguments, function(a){ try { return typeof a==='string'?a:JSON.stringify(a); } catch(e){ return String(a);} }).join(' ');
                bridgeLog(k, msg);
              } catch (e) {}
              try { orig.apply(null, arguments); } catch(e) {}
            };
          });
        })();
        window.onerror = function(message, source, lineno, colno, error){ bridgeLog('error', 'onerror: '+message+' @'+source+':'+lineno+':'+colno+' '+(error&&error.stack?error.stack:'')); };
        window.addEventListener('unhandledrejection', function(ev){ try { var r=ev&&ev.reason; bridgeLog('error', 'unhandledrejection: '+(r&&r.stack?r.stack:(r&&r.message?r.message:String(r)))); } catch(e){} });

        async function init() {
          try {
            await TrezorConnect.init({
              connectSrc: 'https://connect.trezor.io/9/',
              manifest: { email: 'support@nullwallet.app', appUrl: 'https://nullwallet.app' },
              lazyLoad: true,
              transportReconnect: true,
            });
            bridgeLog('info', 'TrezorConnect initialized');
          } catch (e) {
            bridgeLog('error', 'Init error: ' + (e && e.message ? e.message : e));
          }
        }
        try { bridgeLog('info', 'userAgent: '+navigator.userAgent); } catch(e) {}
        try { bridgeLog('info', 'document.readyState: '+document.readyState); } catch(e) {}

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
              bridgeLog('info', 'handleMessage id='+id+' action='+action);
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
              bridgeLog('info', 'result for id='+id+': '+(result && typeof result === 'object' ? JSON.stringify({ success: result.success, payload: (result.payload && result.payload.address ? { address: result.payload.address } : 'ok') }) : String(result)) );
              postMessageToRN({ id: id, status: 'success', result: result });
            } catch (e) {
              bridgeLog('error', 'error for id='+id+': '+(e&&e.message?e.message:String(e)));
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
