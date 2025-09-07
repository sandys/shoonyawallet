import React, { useCallback, useEffect, useRef, useState } from 'react';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { View, Text, Button, ActivityIndicator, StyleSheet, Platform, Modal, ScrollView, Pressable, TextInput } from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import type { WebViewMessageEvent } from 'react-native-webview';
import { WebView } from 'react-native-webview';
import InAppBrowser from 'react-native-inappbrowser-reborn';
import StaticServer from '@dr.pogodin/react-native-static-server';
import { DocumentDirectoryPath, mkdir, writeFile } from '@dr.pogodin/react-native-fs';
import { Linking } from 'react-native';
import { openPartialCustomTab } from './src/native/ChromeTabs';

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
  const [addrPrefix, setAddrPrefix] = useState<string>("m/44'/60'/0'/0/");
  const [addrStart, setAddrStart] = useState<string>('0');
  const [addrCount, setAddrCount] = useState<string>('5');
  const [addrList, setAddrList] = useState<string[]>([]);
  const [showPermissionHelp, setShowPermissionHelp] = useState(false);
  const [webviewReady, setWebviewReady] = useState(false);
  const readyWaiters = useRef<Array<() => void>>([]);

  const webviewRef = useRef<WebView>(null);
  const reqId = useRef(1);
  const pending = useRef(new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>());
  const cctPending = useRef<{ action: string; resolve: (v: any)=>void; reject: (e:any)=>void } | null>(null);

  const serverRef = useRef<{ server: StaticServer | null; baseUrl: string | null; ready: boolean }>({ server: null, baseUrl: null, ready: false });

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

  // ---------- Chrome Custom Tab + Localhost server flow ----------
  const TREZOR_PAGE_NAME = 'trezor.html';
  const CALLBACK_URL = 'sifar://trezor-callback';

  const ensureLocalServer = useCallback(async (): Promise<string> => {
    if (serverRef.current.ready && serverRef.current.baseUrl) return serverRef.current.baseUrl as string;
    try {
      const dir = `${DocumentDirectoryPath}/trezor_handler`;
      await mkdir(dir).catch(() => {});
      await writeFile(`${dir}/${TREZOR_PAGE_NAME}`, trezorHandlerHtml, 'utf8');
      const server = new StaticServer({ fileDir: dir, hostname: '127.0.0.1', port: 0 });
      const origin = await server.start('Start server');
      let baseUrl = origin;
      try { const u = new URL(origin); baseUrl = `http://localhost:${(u as any).port}`; } catch (_) {}
      serverRef.current = { server, baseUrl, ready: true };
      logInfo(`Local server started at ${baseUrl} (origin=${origin})`);
      return baseUrl;
    } catch (e: any) {
      const msg = e?.message ?? String(e);
      logError(`Failed to start local server: ${msg}`);
      throw e;
    }
  }, [logInfo, logError]);

  const onDeepLink = useCallback((event: { url: string }) => {
    try {
      const url = event.url || '';
      logInfo(`Deep link: ${url}`);
      const u = new URL(url);
      if (u.protocol !== 'sifar:' || u.host !== 'trezor-callback') return;
      const status = u.searchParams.get('status') || 'error';
      const data = u.searchParams.get('data') || '';
      const pendingAction = cctPending.current;
      cctPending.current = null;
      if (!pendingAction) return;
      if (status === 'success') {
        try {
          const decoded = decodeURIComponent(data);
          const json = JSON.parse(decoded);
          logInfo(`CCT success for ${pendingAction.action}`);
          pendingAction.resolve(json);
        } catch (e: any) {
          const msg = e?.message ?? String(e);
          logError(`Failed to parse deep link data: ${msg}`);
          pendingAction.reject(new Error(msg));
        }
      } else {
        const err = decodeURIComponent(data);
        logError(`CCT error for ${pendingAction.action}: ${err}`);
        pendingAction.reject(new Error(err || 'Canceled'));
      }
      try { InAppBrowser.close(); } catch (_) {}
    } catch (e: any) {
      logError(`onDeepLink error: ${e?.message ?? String(e)}`);
    }
  }, [logInfo, logError]);

  useEffect(() => {
    const sub = Linking.addEventListener('url', onDeepLink);
    return () => {
      // @ts-ignore newer RN returns remove() otherwise removeEventListener
      if (sub && typeof sub.remove === 'function') sub.remove();
      // legacy cleanup
      // Linking.removeEventListener?.('url', onDeepLink);
    };
  }, [onDeepLink]);

  const openCctFlow = useCallback(async (action: 'eth_getAddress' | 'eth_signTransaction', payload: any) => {
    const baseUrl = await ensureLocalServer();
    const page = `${baseUrl.replace(/\/$/, '')}/${TREZOR_PAGE_NAME}`;
    const q = new URLSearchParams();
    q.set('action', action);
    q.set('payload', encodeURIComponent(JSON.stringify(payload || {})));
    q.set('callback', encodeURIComponent(CALLBACK_URL));
    const url = `${page}?${q.toString()}`;
    logInfo(`Opening CCT: ${url}`);
    return new Promise<any>(async (resolve, reject) => {
      cctPending.current = { action, resolve, reject };
      try {
        // Require partial Custom Tab for proper UX
        const launched = await openPartialCustomTab(url, 0.5);
        if (!launched) {
          logError('Partial CCT not available - this is required for proper UX');
          throw new Error('Partial Custom Tabs not supported on this device. Please update Chrome or your Android system.');
        }
        logInfo('Using partial CCT (embedded)');
      } catch (e: any) {
        const msg = e?.message ?? String(e);
        logError(`CCT open failed: ${msg}`);
        cctPending.current = null;
        reject(e);
      }
    });
  }, [ensureLocalServer, logInfo, logError]);

  const fetchAddressesCct = useCallback(async () => {
    try {
      const baseUrl = await ensureLocalServer();
      const page = `${baseUrl.replace(/\/$/, '')}/${TREZOR_PAGE_NAME}`;
      const payload = {
        pathPrefix: addrPrefix,
        start: Math.max(0, parseInt(addrStart || '0', 10) || 0),
        count: Math.min(20, Math.max(1, parseInt(addrCount || '1', 10) || 1)),
        showOnTrezor: false,
      };
      const q = new URLSearchParams();
      q.set('action', 'eth_getAddressList');
      q.set('payload', encodeURIComponent(JSON.stringify(payload)));
      q.set('callback', encodeURIComponent(CALLBACK_URL));
      const url = `${page}?${q.toString()}`;
      logInfo(`Opening CCT (address list): ${url}`);
      await new Promise<void>(async (resolve, reject) => {
        cctPending.current = { action: 'eth_getAddressList', resolve: (res: any) => { try {
          const list: string[] = res?.payload?.addresses || res?.addresses || [];
          if (Array.isArray(list)) {
            setAddrList(list);
            logInfo(`Received ${list.length} addresses`);
          } else {
            logWarn(`No addresses in response: ${JSON.stringify(res)}`);
          }
        } catch (e) { logError(`Address parse failed: ${String(e)}`); } finally { resolve(); } }, reject } as any;
        try {
          // Try partial Custom Tab first (embedded)
          const launched = await openPartialCustomTab(url, 0.4);
          if (!launched) {
            logError('Partial CCT not available - this is required for proper UX');
            logError('Full-screen browser would block React Native UI');
            throw new Error('Partial Custom Tabs not supported on this device. Please update Chrome or your Android system.');
          } else {
            logInfo('Using partial CCT (embedded)');
            // Add timeout in case CCT opens full-screen instead of partial
            setTimeout(() => {
              if (cctPending.current) {
                logWarn('CCT taking too long - it may have opened full-screen. Try closing the browser manually.');
                logWarn('If browser is stuck, try pressing the back button or force-closing Chrome.');
              }
            }, 3000);
          }
        } catch (e) {
          cctPending.current = null; reject(e);
        }
      });
    } catch (e: any) {
      logError(`fetchAddressesCct failed: ${e?.message ?? String(e)}`);
    }
  }, [ensureLocalServer, addrPrefix, addrStart, addrCount, logInfo, logWarn, logError]);

  useEffect(() => {
    log(`App mounted (${Platform.OS})`);
  }, [log]);

  // Auto-probe once WebView is ready to surface transport errors early
  useEffect(() => {
    if (!webviewReady) return;
    (async () => {
      try {
        logInfo('Auto probe: getFeatures');
        const res = await sendToBridge('getFeatures');
        logInfo(`Probe result: ${JSON.stringify(res)}`);
      } catch (e: any) {
        logError(`Probe failed: ${e?.message ?? String(e)}`);
      }
    })();
  }, [webviewReady, sendToBridge, logInfo, logError]);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.root}>
        <Text style={styles.title}>sifar</Text>
        {Platform.OS === 'ios' && (
          <Text style={styles.warn}>iOS is not supported for WebUSB/Trezor.</Text>
        )}
        <View style={styles.section}>
          <Text style={styles.subtitle}>Trezor (Chrome • WebUSB)</Text>
          <ActivityIndicator size="small" />
          <Text style={styles.status}>Status: {phase}</Text>
          <Text style={styles.help}>
            Connect your Trezor via USB-OTG. Grant USB access if prompted.
          </Text>
          <View style={{ gap: 8 }}>
            <Text style={styles.subtitle}>Address Discovery</Text>
            <Text style={styles.help}>Derivation path prefix</Text>
            <View style={styles.readonlyBox}>
              <Text selectable style={styles.mono}>{addrPrefix}</Text>
            </View>
            <View style={styles.btnrow}>
              <Button title="Use Trezor Default" onPress={() => setAddrPrefix("m/44'/60'/0'/0/")} />
            </View>
            <View style={{ gap: 6 }}>
              <Text style={styles.help}>Start index (i in m/44'/60'/0'/0/i)</Text>
              <TextInput
                value={addrStart}
                onChangeText={(v) => setAddrStart((v || '').replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                inputMode="numeric"
                placeholder="0"
                style={styles.input}
              />
              <Text style={styles.help}>Count (how many addresses to list)</Text>
              <TextInput
                value={addrCount}
                onChangeText={(v) => setAddrCount((v || '').replace(/[^0-9]/g, ''))}
                keyboardType="number-pad"
                inputMode="numeric"
                placeholder="5"
                style={styles.input}
              />
            </View>
            <Button title="Fetch Addresses" onPress={fetchAddressesCct} />
            {addrList.length > 0 && (
              <View style={{ marginTop: 6 }}>
                <Text style={styles.subtitle}>Addresses</Text>
                {addrList.map((a, i) => (
                  <View key={i} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <Text style={styles.mono}>#{i + Number(addrStart || '0')}</Text>
                    <View style={styles.readonlyPill}><Text selectable style={styles.mono}>{a}</Text></View>
                  </View>
                ))}
              </View>
            )}
          </View>
          {/* Test-only trigger to exercise WV bridge during Jest */}
          {(global as any).__TEST__ ? (
            <Pressable testID="btnGetAddress" onPress={() => start()} accessibilityRole="button">
              <Text style={styles.mono}>[TEST] Get ETH Address</Text>
            </Pressable>
          ) : null}
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
  readonlyBox: { borderWidth: 1, borderColor: '#ddd', borderRadius: 6, padding: 8, backgroundColor: '#f7f7fa' },
  readonlyPill: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 4, paddingVertical: 4, paddingHorizontal: 6, backgroundColor: '#f9fafb' },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 10,
    fontSize: 14,
    backgroundColor: '#fff',
  },
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
              // Embedded WebView specifics
              popup: false,
              lazyLoad: false,
              debug: true,
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
                case 'eth_getAddressList':
                  var list = [];
                  var start = (payload && payload.start) || 0;
                  var count = (payload && payload.count) || 1;
                  var prefix = (payload && payload.pathPrefix) || "m/44'\\/60'\\/0'\\/0\\/";
                  for (var i=0;i<count;i++) {
                    var p = prefix + String(start+i);
                    var r = await TrezorConnect.ethereumGetAddress({ path: p, showOnTrezor: !!(payload && payload.showOnTrezor) });
                    if (r && r.success && r.payload && r.payload.address) list.push(r.payload.address);
                    else list.push(null);
                  }
                  result = { success: true, payload: { addresses: list } };
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
    <script>
      // CCT handler page: execute based on query params and deep-link result back
      (function(){
        try {
          var params = new URLSearchParams(location.search);
          var action = params.get('action');
          var payloadStr = params.get('payload') || '{}';
          try { payloadStr = decodeURIComponent(payloadStr); } catch(e){}
          var payload = {}; try { payload = JSON.parse(payloadStr); } catch(e) { console.error('payload parse error', e); }
          var callback = params.get('callback') || '';
          console.info('CCT handler: action=', action);
          if (!action) return;
          function cb(status, data){
            if (!callback) { console.warn('No callback provided'); return; }
            try {
              var u = new URL(callback);
              u.searchParams.set('status', status);
              var dataStr = typeof data === 'string' ? data : JSON.stringify(data || {});
              u.searchParams.set('data', encodeURIComponent(dataStr));
              location.replace(u.toString());
            } catch(e) { console.error('callback build failed', e); }
          }
          // Ensure Trezor is initialized (from earlier block)
          ;(async function(){
            try {
              console.info('CCT invoking Trezor action:', action);
              var result;
              if (action === 'eth_getAddress') {
                result = await TrezorConnect.ethereumGetAddress(payload);
              } else if (action === 'eth_signTransaction') {
                result = await TrezorConnect.ethereumSignTransaction(payload);
              } else if (action === 'getFeatures') {
                result = await TrezorConnect.getFeatures();
              } else {
                throw new Error('Unsupported action: '+action);
              }
              if (result && result.success) cb('success', result); else cb('error', (result && result.payload && result.payload.error) || 'Unknown');
            } catch(e){
              console.error('CCT Trezor call failed', e);
              cb('error', e && e.message ? e.message : String(e));
            }
          })();
        } catch(e) { console.error('CCT handler error', e); }
      })();
    </script>
  </body>
  </html>`;

// Standalone handler HTML for CCT served from localhost (self-contained)
const trezorHandlerHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset=\"utf-8\" />
  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
  <title>sifar Trezor Handler</title>
  <script src=\"https://connect.trezor.io/9/trezor-connect.js\"></script>
  <style> body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Ubuntu,Cantarell,\"Noto Sans\",sans-serif;padding:12px} pre{white-space:pre-wrap;word-break:break-word;background:#f3f4f6;padding:8px;border-radius:6px} .warn{color:#b45309} .ok{color:#065f46} .err{color:#991b1b}</style>
</head>
<body>
  <h2>sifar – Trezor Handler</h2>
  <div id=\"st\">Initializing…</div>
  <pre id=\"lg\"></pre>
  <script>
    var st = document.getElementById('st');
    var lg = document.getElementById('lg');
    function log(m){ try{ lg.textContent += m + "\n"; }catch(e){} }
    function set(m, cls){ st.textContent = m; st.className = cls||''; }
    function bridgeLog(level, msg){ log('['+level.toUpperCase()+'] '+msg); }
    window.onerror = function(message, source, lineno, colno, error){ bridgeLog('error', 'onerror: '+message+' @'+source+':'+lineno+':'+colno); };
    window.addEventListener('unhandledrejection', function(e){ bridgeLog('error', 'unhandledrejection: '+(e && e.reason && (e.reason.message||e.reason) || '')); });
    (async function(){
      try{
        bridgeLog('info', 'userAgent: '+navigator.userAgent);
        await TrezorConnect.init({
          popup: false,
          lazyLoad: false,
          debug: true,
          manifest: { email: 'support@nullwallet.app', appUrl: 'https://nullwallet.app' },
        });
        bridgeLog('info', 'TrezorConnect initialized');
        set('Ready', 'ok');
      }catch(e){ set('Init error: '+(e && e.message || e), 'err'); log(String(e && e.stack || e)); }
      // Execute based on query
      try{
        var q = new URLSearchParams(location.search);
        var action = q.get('action');
        var payloadStr = q.get('payload')||'{}';
        try{ payloadStr = decodeURIComponent(payloadStr);}catch(e){}
        var payload = {}; try{ payload = JSON.parse(payloadStr);}catch(e){ bridgeLog('warn','payload parse fail: '+e); }
        var callback = q.get('callback')||'';
        bridgeLog('info', 'action='+action);
        function finish(status, data){ try{ var u=new URL(callback); u.searchParams.set('status',status); var ds= typeof data==='string'?data:JSON.stringify(data||{}); u.searchParams.set('data', encodeURIComponent(ds)); location.replace(u.toString()); }catch(e){ bridgeLog('error','callback build failed: '+e);} }
        if (!action) return;
        try{
          let result;
          if (action==='eth_getAddress') result = await TrezorConnect.ethereumGetAddress(payload);
          else if (action==='eth_getAddressList') {
            // Handle address list request by making multiple getAddress calls
            var pathPrefix = payload.pathPrefix || "m/44'/60'/0'/0/";
            var start = payload.start || 0;
            var count = Math.min(payload.count || 5, 20); // max 20 addresses
            var showOnTrezor = !!payload.showOnTrezor;
            var addresses = [];
            for (var i = 0; i < count; i++) {
              var path = pathPrefix + (start + i);
              var res = await TrezorConnect.ethereumGetAddress({path: path, showOnTrezor: showOnTrezor});
              if (res && res.success && res.payload && res.payload.address) {
                addresses.push(res.payload.address);
              } else {
                throw new Error('Failed to get address at index ' + (start + i) + ': ' + (res && res.payload && res.payload.error || 'Unknown'));
              }
            }
            result = {success: true, payload: {addresses: addresses}};
          }
          else if (action==='eth_signTransaction') result = await TrezorConnect.ethereumSignTransaction(payload);
          else if (action==='getFeatures') result = await TrezorConnect.getFeatures();
          else throw new Error('Unsupported action: '+action);
          log('Result: '+JSON.stringify(result));
          if (result && result.success) finish('success', result); else finish('error', (result && result.payload && result.payload.error)||'Unknown');
        }catch(e){ bridgeLog('error','call failed: '+e); finish('error', e && e.message ? e.message : String(e)); }
      }catch(e){ bridgeLog('error','handler crash: '+e); }
    })();
  </script>
</body>
</html>`;
