import React, { useState } from 'react';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';

interface PassphraseModalProps {
  visible: boolean;
  onSubmit: (passphrase: string) => void;
  onCancel: () => void;
}

export const PassphraseModal: React.FC<PassphraseModalProps> = ({
  visible,
  onSubmit,
  onCancel,
}) => {
  const [passphrase, setPassphrase] = useState('');
  const [confirmPassphrase, setConfirmPassphrase] = useState('');

  const handleSubmit = () => {
    if (passphrase !== confirmPassphrase) {
      Alert.alert('Error', 'Passphrases do not match');
      return;
    }
    onSubmit(passphrase);
    setPassphrase('');
    setConfirmPassphrase('');
  };

  const handleCancel = () => {
    setPassphrase('');
    setConfirmPassphrase('');
    onCancel();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={handleCancel}
    >
      <View style={styles.overlay}>
        <View style={styles.modal}>
          <Text style={styles.title}>Enter Trezor Passphrase</Text>
          <Text style={styles.description}>
            Your Trezor device is requesting a passphrase. Enter it below to continue.
          </Text>
          
          <TextInput
            style={styles.input}
            value={passphrase}
            onChangeText={setPassphrase}
            placeholder="Enter passphrase"
            secureTextEntry
            autoFocus
          />
          
          <TextInput
            style={styles.input}
            value={confirmPassphrase}
            onChangeText={setConfirmPassphrase}
            placeholder="Confirm passphrase"
            secureTextEntry
          />
          
          <View style={styles.buttonContainer}>
            <TouchableOpacity style={styles.cancelButton} onPress={handleCancel}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            
            <TouchableOpacity style={styles.submitButton} onPress={handleSubmit}>
              <Text style={styles.submitButtonText}>Submit</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modal: {
    backgroundColor: 'white',
    borderRadius: 10,
    padding: 20,
    width: '90%',
    maxWidth: 400,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
    textAlign: 'center',
  },
  description: {
    fontSize: 14,
    color: '#666',
    marginBottom: 20,
    textAlign: 'center',
    lineHeight: 20,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 5,
    padding: 12,
    marginBottom: 15,
    fontSize: 16,
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  cancelButton: {
    backgroundColor: '#f5f5f5',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 5,
    flex: 1,
    marginRight: 10,
  },
  submitButton: {
    backgroundColor: '#007AFF',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 5,
    flex: 1,
    marginLeft: 10,
  },
  cancelButtonText: {
    textAlign: 'center',
    fontSize: 16,
    color: '#666',
  },
  submitButtonText: {
    textAlign: 'center',
    fontSize: 16,
    color: 'white',
    fontWeight: '500',
  },
});