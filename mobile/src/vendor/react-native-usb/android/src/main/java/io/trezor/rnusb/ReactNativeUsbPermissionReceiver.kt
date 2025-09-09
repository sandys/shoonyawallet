package io.trezor.rnusb

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbManager
import android.os.Build
import android.util.Log

class ReactNativeUsbPermissionReceiver : BroadcastReceiver() {
    companion object {
        private const val TAG = "UsbPermissionReceiver"
        private var onPermissionCallback: ((Boolean, UsbDevice?) -> Unit)? = null
        
        fun setOnPermissionCallback(callback: (Boolean, UsbDevice?) -> Unit) {
            onPermissionCallback = callback
        }
    }

    override fun onReceive(context: Context?, intent: Intent?) {
        val action = intent?.action
        if (action == "io.trezor.rnusb.USB_PERMISSION") {
            val device: UsbDevice? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
            } else {
                @Suppress("DEPRECATION")
                intent.getParcelableExtra(UsbManager.EXTRA_DEVICE)
            }

            val permissionGranted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
            Log.d(TAG, "USB permission result: $permissionGranted for device: ${device?.deviceName}")
            
            onPermissionCallback?.invoke(permissionGranted, device)
        }
    }
}