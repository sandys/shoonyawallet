import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
} from 'react-native';
import { useTrezor } from '../hooks/useTrezor';
import { PassphraseModal } from '../components/PassphraseModal';

export const TrezorTestScreen: React.FC = () => {
  const {
    isConnected,
    publicKey,
    isConnecting,
    logs,
    passphraseRequired,
    connect,
    disconnect,
    submitPassphrase,
    cancelPassphrase,
  } = useTrezor();

  const handleConnect = async () => {
    try {
      const key = await connect();
      Alert.alert('Success', `Connected! Public key: ${key.substring(0, 10)}...`);
    } catch (error) {
      Alert.alert('Error', `Failed to connect: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Trezor Connection Test</Text>
      
      <View style={styles.statusContainer}>
        <Text style={styles.statusLabel}>Status:</Text>
        <Text style={[
          styles.statusText,
          isConnected ? styles.statusConnected : isConnecting ? styles.statusConnecting : styles.statusDisconnected
        ]}>
          {isConnecting ? 'Connecting...' : isConnected ? 'Connected' : 'Disconnected'}
        </Text>
      </View>

      {publicKey && (
        <View style={styles.keyContainer}>
          <Text style={styles.keyLabel}>Public Key:</Text>
          <Text style={styles.keyText}>{publicKey}</Text>
        </View>
      )}

      <View style={styles.buttonContainer}>
        {!isConnected && !isConnecting && (
          <TouchableOpacity style={styles.connectButton} onPress={handleConnect}>
            <Text style={styles.buttonText}>Connect Trezor</Text>
          </TouchableOpacity>
        )}

        {(isConnected || isConnecting) && (
          <TouchableOpacity style={styles.disconnectButton} onPress={disconnect}>
            <Text style={styles.buttonText}>Disconnect</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.logContainer}>
        <Text style={styles.logTitle}>Connection Logs:</Text>
        <ScrollView style={styles.logScroll}>
          {logs.map((log, index) => (
            <Text key={index} style={styles.logText}>{log}</Text>
          ))}
        </ScrollView>
      </View>

      <PassphraseModal
        visible={passphraseRequired}
        onSubmit={submitPassphrase}
        onCancel={cancelPassphrase}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: '#f5f5f5',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 30,
  },
  statusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
  },
  statusLabel: {
    fontSize: 16,
    fontWeight: '500',
    marginRight: 10,
  },
  statusText: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  statusConnected: {
    color: '#00C851',
  },
  statusConnecting: {
    color: '#FF8800',
  },
  statusDisconnected: {
    color: '#FF4444',
  },
  keyContainer: {
    backgroundColor: 'white',
    padding: 15,
    borderRadius: 8,
    marginBottom: 20,
  },
  keyLabel: {
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 5,
    color: '#666',
  },
  keyText: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: '#333',
    lineHeight: 18,
  },
  buttonContainer: {
    marginBottom: 20,
  },
  connectButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 15,
    borderRadius: 8,
    alignItems: 'center',
  },
  disconnectButton: {
    backgroundColor: '#FF3B30',
    paddingVertical: 15,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: '500',
  },
  logContainer: {
    flex: 1,
    backgroundColor: 'white',
    borderRadius: 8,
    padding: 10,
  },
  logTitle: {
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 10,
  },
  logScroll: {
    flex: 1,
  },
  logText: {
    fontSize: 12,
    fontFamily: 'monospace',
    color: '#666',
    marginBottom: 2,
  },
});