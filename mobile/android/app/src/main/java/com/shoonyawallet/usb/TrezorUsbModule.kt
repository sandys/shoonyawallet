package com.shoonyawallet.usb

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbConstants
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbEndpoint
import android.hardware.usb.UsbInterface
import android.hardware.usb.UsbManager
import android.os.Build
import com.facebook.react.bridge.*
import android.util.Log
import android.os.SystemClock

class TrezorUsbModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    private val ACTION_USB_PERMISSION = "com.shoonyawallet.USB_PERMISSION"
    private var connection: UsbDeviceConnection? = null
    private var iface: UsbInterface? = null
    private var inEndpoint: UsbEndpoint? = null
    private var outEndpoint: UsbEndpoint? = null
    private val logBuf: ArrayDeque<String> = ArrayDeque()

    private fun addLog(message: String) {
        val ts = System.currentTimeMillis()
        val line = "[$ts] $message"
        Log.d("TrezorUsb", message)
        logBuf.addLast(line)
        while (logBuf.size > 300) logBuf.removeFirst()
    }

    override fun getName() = "TrezorUsb"

    @ReactMethod
    fun listDevices(promise: Promise) {
        val usbManager = reactContext.getSystemService(Context.USB_SERVICE) as UsbManager
        val result = Arguments.createArray()
        for ((_, dev) in usbManager.deviceList) {
            if (isTrezor(dev)) {
                val m = Arguments.createMap()
                m.putInt("vendorId", dev.vendorId)
                m.putInt("productId", dev.productId)
                m.putString("deviceName", dev.deviceName)
                result.pushMap(m)
            }
        }
        addLog("listDevices found ${result.size()} candidate(s)")
        promise.resolve(result)
    }

    @ReactMethod
    fun requestPermission(vendorId: Int, productId: Int, promise: Promise) {
        val usbManager = reactContext.getSystemService(Context.USB_SERVICE) as UsbManager
        val dev = usbManager.deviceList.values.firstOrNull { it.vendorId == vendorId && it.productId == productId }
        if (dev == null) {
            promise.reject("NO_DEVICE", "Device not found")
            return
        }
        if (usbManager.hasPermission(dev)) {
            addLog("USB permission already granted for vid=$vendorId pid=$productId")
            promise.resolve(true)
            return
        }
        val piFlags = if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0
        val permissionIntent = PendingIntent.getBroadcast(reactContext, 0, Intent(ACTION_USB_PERMISSION), piFlags)
        val filter = IntentFilter(ACTION_USB_PERMISSION)
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                if (intent?.action == ACTION_USB_PERMISSION) {
                    reactContext.unregisterReceiver(this)
                    val granted = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
                    addLog("USB permission result: granted=$granted")
                    if (granted) promise.resolve(true) else promise.reject("DENIED", "Permission denied")
                }
            }
        }
        reactContext.registerReceiver(receiver, filter)
        addLog("Requesting USB permission for vid=$vendorId pid=$productId")
        usbManager.requestPermission(dev, permissionIntent)
    }

    @ReactMethod
    fun open(vendorId: Int, productId: Int, promise: Promise) {
        val usbManager = reactContext.getSystemService(Context.USB_SERVICE) as UsbManager
        val dev = usbManager.deviceList.values.firstOrNull { it.vendorId == vendorId && it.productId == productId }
        if (dev == null) { promise.reject("NO_DEVICE", "Device not found"); return }
        if (!usbManager.hasPermission(dev)) { promise.reject("NO_PERMISSION", "USB permission not granted"); return }

        // Find HID interface with IN/OUT endpoints
        var targetIface: UsbInterface? = null
        var epIn: UsbEndpoint? = null
        var epOut: UsbEndpoint? = null
        for (i in 0 until dev.interfaceCount) {
            val itf = dev.getInterface(i)
            addLog("iface #$i class=${itf.interfaceClass} subclass=${itf.interfaceSubclass} proto=${itf.interfaceProtocol} eps=${itf.endpointCount}")
            var tmpIn: UsbEndpoint? = null
            var tmpOut: UsbEndpoint? = null
            for (e in 0 until itf.endpointCount) {
                val ep = itf.getEndpoint(e)
                addLog("  ep #$e type=${ep.type} dir=${ep.direction} mps=${ep.maxPacketSize}")
                // Prefer INTERRUPT endpoints for HID; fall back to BULK if needed
                if (ep.type == UsbConstants.USB_ENDPOINT_XFER_INT) {
                    if (ep.direction == UsbConstants.USB_DIR_IN) tmpIn = ep
                    if (ep.direction == UsbConstants.USB_DIR_OUT) tmpOut = ep
                }
            }
            if (tmpIn != null && tmpOut != null) {
                targetIface = itf; epIn = tmpIn; epOut = tmpOut; break
            }
        }
        // If not found via INT, try BULK as a fallback
        if (targetIface == null) {
            for (i in 0 until dev.interfaceCount) {
                val itf = dev.getInterface(i)
                var tmpIn: UsbEndpoint? = null
                var tmpOut: UsbEndpoint? = null
                for (e in 0 until itf.endpointCount) {
                    val ep = itf.getEndpoint(e)
                    if (ep.type == UsbConstants.USB_ENDPOINT_XFER_BULK) {
                        if (ep.direction == UsbConstants.USB_DIR_IN) tmpIn = ep
                        if (ep.direction == UsbConstants.USB_DIR_OUT) tmpOut = ep
                    }
                }
                if (tmpIn != null && tmpOut != null) { targetIface = itf; epIn = tmpIn; epOut = tmpOut; break }
            }
        }
        if (targetIface == null || epIn == null || epOut == null) { promise.reject("NO_ENDPOINTS", "No suitable endpoints found"); return }

        val conn = usbManager.openDevice(dev) ?: run { promise.reject("OPEN_FAILED", "Failed to open device"); return }
        if (!conn.claimInterface(targetIface, true)) { promise.reject("CLAIM_FAILED", "Failed to claim interface"); return }
        connection = conn; iface = targetIface; inEndpoint = epIn; outEndpoint = epOut
        addLog("Opened device vid=${dev.vendorId} pid=${dev.productId} iface=${targetIface.id} inMps=${epIn.maxPacketSize} outMps=${epOut.maxPacketSize}")
        promise.resolve(true)
    }

    @ReactMethod
    fun close(promise: Promise) {
        try {
            connection?.releaseInterface(iface)
            connection?.close()
            connection = null; iface = null; inEndpoint = null; outEndpoint = null
            promise.resolve(true)
        } catch (e: Exception) {
            promise.reject("CLOSE_FAILED", e)
        }
    }

    @ReactMethod
    fun exchange(write: ReadableArray, timeoutMs: Int, promise: Promise) {
        val conn = connection ?: run { promise.reject("NOT_OPEN", "Connection not open"); return }
        val out = outEndpoint ?: run { promise.reject("NO_OUT", "Missing OUT endpoint"); return }
        val inp = inEndpoint ?: run { promise.reject("NO_IN", "Missing IN endpoint"); return }

        val size = write.size()
        if (size > 0) {
            val data = ByteArray(size) { i -> write.getInt(i).toByte() }
            val preview = data.take(16).joinToString(" ") { b -> String.format("%02X", (b.toInt() and 0xFF)) }
            addLog("TX[${data.size}]: $preview …")
            val w = conn.bulkTransfer(out, data, data.size, timeoutMs)
            addLog("Wrote ${data.size} bytes, result=$w")
            if (w <= 0) { promise.reject("WRITE_FAIL", "bulkTransfer write failed: $w"); return }
        }

        // Read loop: attempt multiple reads until bytes arrive or timeout elapses
        val start = SystemClock.elapsedRealtime()
        val outArr = Arguments.createArray()
        val buf = ByteArray(65) // accommodate potential leading report-id byte
        var total = 0
        while (true) {
            val elapsed = (SystemClock.elapsedRealtime() - start).toInt()
            val remain = timeoutMs - elapsed
            if (remain <= 0) break
            val r = conn.bulkTransfer(inp, buf, buf.size, remain)
            if (r > 0) {
                val preview = buf.take(minOf(r, 16)).joinToString(" ") { b -> String.format("%02X", (b.toInt() and 0xFF)) }
                addLog("RX[$r]: $preview …")
                for (i in 0 until r) outArr.pushInt(buf[i].toInt() and 0xFF)
                total += r
                break
            }
        }
        if (total == 0) { promise.reject("READ_FAIL", "bulkTransfer read failed: -1"); return }
        promise.resolve(outArr)
    }

    @ReactMethod
    fun getDebugLog(promise: Promise) {
        val arr = Arguments.createArray()
        logBuf.forEach { arr.pushString(it) }
        promise.resolve(arr)
    }

    @ReactMethod
    fun clearDebugLog(promise: Promise) {
        logBuf.clear()
        promise.resolve(true)
    }

    private fun isTrezor(dev: UsbDevice): Boolean {
        // Trezor vendor ids commonly seen: 0x1209 (4617), SatoshiLabs 0x534C? Also 0x21324 in some mappings.
        val knownVendors = setOf(0x1209, 0x534C, 21324)
        return knownVendors.contains(dev.vendorId)
    }
}
