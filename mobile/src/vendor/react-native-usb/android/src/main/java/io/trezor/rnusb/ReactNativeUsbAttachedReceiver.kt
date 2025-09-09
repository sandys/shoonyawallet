package io.trezor.rnusb

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Build
import android.util.Log

class ReactNativeUsbAttachedReceiver : BroadcastReceiver() {
    companion object {
        private const val TAG = "UsbAttachedReceiver"
        private var onDeviceConnectCallback: ((UsbDevice) -> Unit)? = null
        
        fun setOnDeviceConnectCallback(callback: (UsbDevice) -> Unit) {
            onDeviceConnectCallback = callback
        }
    }

    override fun onReceive(context: Context?, intent: Intent?) {
        if (intent?.action == UsbManager.ACTION_USB_DEVICE_ATTACHED) {
            val device: UsbDevice? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
            } else {
                @Suppress("DEPRECATION")
                intent.getParcelableExtra(UsbManager.EXTRA_DEVICE)
            }

            if (device != null) {
                Log.d(TAG, "USB device attached: ${device.deviceName}")
                onDeviceConnectCallback?.invoke(device)
            }
        }
    }
}