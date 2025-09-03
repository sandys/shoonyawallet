import React from 'react';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { PassphraseModal } from '../src/components/PassphraseModal';

describe('PassphraseModal', () => {
  const mockOnSubmit = jest.fn();
  const mockOnCancel = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders when visible is true', () => {
    const { getByText, getByPlaceholderText } = render(
      <PassphraseModal
        visible={true}
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
      />
    );

    expect(getByText('Enter Trezor Passphrase')).toBeTruthy();
    expect(getByPlaceholderText('Enter passphrase')).toBeTruthy();
    expect(getByPlaceholderText('Confirm passphrase')).toBeTruthy();
  });

  it('does not render when visible is false', () => {
    const { queryByText } = render(
      <PassphraseModal
        visible={false}
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
      />
    );

    expect(queryByText('Enter Trezor Passphrase')).toBeNull();
  });

  it('calls onSubmit when passphrases match', async () => {
    const { getByPlaceholderText, getByText } = render(
      <PassphraseModal
        visible={true}
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
      />
    );

    const passphraseInput = getByPlaceholderText('Enter passphrase');
    const confirmInput = getByPlaceholderText('Confirm passphrase');
    const submitButton = getByText('Submit');

    fireEvent.changeText(passphraseInput, 'test123');
    fireEvent.changeText(confirmInput, 'test123');
    fireEvent.press(submitButton);

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith('test123');
    });
  });

  it('shows error when passphrases do not match', async () => {
    const { getByPlaceholderText, getByText } = render(
      <PassphraseModal
        visible={true}
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
      />
    );

    const passphraseInput = getByPlaceholderText('Enter passphrase');
    const confirmInput = getByPlaceholderText('Confirm passphrase');
    const submitButton = getByText('Submit');

    fireEvent.changeText(passphraseInput, 'test123');
    fireEvent.changeText(confirmInput, 'different');
    fireEvent.press(submitButton);

    // Should not call onSubmit when passphrases don't match
    expect(mockOnSubmit).not.toHaveBeenCalled();
  });

  it('calls onCancel when cancel button is pressed', async () => {
    const { getByText } = render(
      <PassphraseModal
        visible={true}
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
      />
    );

    const cancelButton = getByText('Cancel');
    fireEvent.press(cancelButton);

    await waitFor(() => {
      expect(mockOnCancel).toHaveBeenCalled();
    });
  });

  it('clears input fields when submitted', async () => {
    const { getByPlaceholderText, getByText } = render(
      <PassphraseModal
        visible={true}
        onSubmit={mockOnSubmit}
        onCancel={mockOnCancel}
      />
    );

    const passphraseInput = getByPlaceholderText('Enter passphrase');
    const confirmInput = getByPlaceholderText('Confirm passphrase');
    const submitButton = getByText('Submit');

    fireEvent.changeText(passphraseInput, 'test123');
    fireEvent.changeText(confirmInput, 'test123');
    fireEvent.press(submitButton);

    await waitFor(() => {
      expect(mockOnSubmit).toHaveBeenCalledWith('test123');
      // Fields should be cleared after submit
      expect(passphraseInput.props.value).toBe('');
      expect(confirmInput.props.value).toBe('');
    });
  });
});