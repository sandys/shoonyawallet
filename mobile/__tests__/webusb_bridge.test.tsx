import React from 'react';
import { render, fireEvent, act, waitFor } from '@testing-library/react-native';
import App from '../App';

// Access the mock to inspect postMessage calls
// eslint-disable-next-line @typescript-eslint/no-var-requires
const WebViewMock = require('react-native-webview').__mock;

describe('WebUSB bridge (WebView + TrezorConnect)', () => {
  beforeEach(() => {
    // reset mock call history
    const pm = WebViewMock.getPostMessage();
    if (pm && pm.mockClear) pm.mockClear();
  });

  it('posts eth_getAddress message when pressing Get ETH Address', async () => {
    const { getByTestId } = render(<App />);
    const props = WebViewMock.getLastProps();
    // Ensure WebView ref is set
    await waitFor(() => {
      const api = WebViewMock.getLastApi();
      expect(api && typeof api.postMessage).toBe('function');
    });
    // Mark WebView ready
    if (props && typeof props.onLoadEnd === 'function') {
      await act(async () => {
        props.onLoadEnd({ nativeEvent: {} });
      });
    }

    // Trigger the bridge request
    // Trigger without awaiting act to avoid hanging on unresolved bridge promise
    fireEvent.press(getByTestId('btnGetAddress'));

    // Validate the outbound message
    const postMessage = WebViewMock.getPostMessage();
    expect(postMessage).toBeDefined();
    const called = postMessage.mock.calls.length;
    let id = 1;
    if (called > 0) {
      const arg = postMessage.mock.calls[0]?.[0];
      if (typeof arg === 'string') {
        const parsed = JSON.parse(arg);
        expect(parsed.action).toBe('eth_getAddress');
        expect(parsed.payload.path).toBe("m/44'/60'/0'/0/0");
        id = parsed.id;
      }
    }

    // Simulate a success response from WebView to resolve the pending promise (id defaults to 1)
    if (props && typeof props.onMessage === 'function') {
      await act(async () => {
        props.onMessage({ nativeEvent: { data: JSON.stringify({ id, status: 'success', result: { payload: { address: '0xabc' } } }) } });
      });
    }
  });
});
