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
import android.hardware.usb.UsbRequest
import java.nio.ByteBuffer
import com.facebook.react.bridge.*
import android.util.Log
import android.os.SystemClock

class TrezorUsbModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
    private val ACTION_USB_PERMISSION = "com.shoonyawallet.USB_PERMISSION"
    private var connection: UsbDeviceConnection? = null
    private var iface: UsbInterface? = null
    private var inEndpoint: UsbEndpoint? = null
    private var outEndpoint: UsbEndpoint? = null
    private var lastOpenInfo: WritableMap? = null
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
        // Android 14 (U) disallows mutable PendingIntent for implicit intents.
        // Use FLAG_IMMUTABLE and make the intent explicit to our package.
        val piFlags = if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0
        val intent = Intent(ACTION_USB_PERMISSION).setPackage(reactContext.packageName)
        val permissionIntent = PendingIntent.getBroadcast(reactContext, 0, intent, piFlags)
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
        // Android 14 requires specifying exportedness when registering receivers.
        if (Build.VERSION.SDK_INT >= 33) {
            reactContext.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
            reactContext.registerReceiver(receiver, filter)
        }
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
                addLog("  ep #$e addr=${ep.address} type=${ep.type} dir=${ep.direction} mps=${ep.maxPacketSize}")
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
        // Capture interface info for JS consumers
        val info = Arguments.createMap()
        info.putInt("interfaceClass", targetIface.interfaceClass)
        info.putInt("interfaceSubclass", targetIface.interfaceSubclass)
        info.putInt("interfaceProtocol", targetIface.interfaceProtocol)
        info.putInt("inEndpointAddress", epIn.address)
        info.putInt("outEndpointAddress", epOut.address)
        info.putInt("inMaxPacketSize", epIn.maxPacketSize)
        info.putInt("outMaxPacketSize", epOut.maxPacketSize)
        lastOpenInfo = info
        promise.resolve(true)
    }

    @ReactMethod
    fun close(promise: Promise) {
        try {
            connection?.releaseInterface(iface)
            connection?.close()
            connection = null; iface = null; inEndpoint = null; outEndpoint = null
            // Keep lastOpenInfo for diagnostics even after close
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
        val readSize = inp.maxPacketSize.coerceAtLeast(64)
        val buf = ByteArray(readSize)
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
        if (total == 0) {
            // Fallback: try interrupt-queue using UsbRequest
            try {
                val usbReq = UsbRequest()
                if (usbReq.initialize(conn, inp)) {
                    val bb = ByteBuffer.allocate(readSize)
                    bb.clear()
                    if (usbReq.queue(bb, readSize)) {
                        val remainTotal = (timeoutMs - (SystemClock.elapsedRealtime() - start)).toInt()
                        val deadline = SystemClock.elapsedRealtime() + remainTotal
                        var done = false
                        while (!done && SystemClock.elapsedRealtime() < deadline) {
                            val waited = conn.requestWait()
                            if (waited === usbReq) {
                                val count = bb.position()
                                if (count > 0) {
                                    val arr = ByteArray(count)
                                    bb.flip(); bb.get(arr)
                                    val preview = arr.take(minOf(count, 16)).joinToString(" ") { b -> String.format("%02X", (b.toInt() and 0xFF)) }
                                    addLog("RX[$count] (irq): $preview …")
                                    for (i in 0 until count) outArr.pushInt(arr[i].toInt() and 0xFF)
                                    total += count
                                }
                                done = true
                            } else if (waited == null) {
                                done = true
                            }
                        }
                        if (!done) {
                            try { usbReq.cancel() } catch (_: Exception) {}
                        }
                    }
                    try { usbReq.close() } catch (_: Exception) {}
                }
            } catch (e: Exception) {
                addLog("UsbRequest fallback failed: ${e.message}")
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

    @ReactMethod
    fun getInterfaceInfo(promise: Promise) {
        promise.resolve(lastOpenInfo ?: Arguments.createMap())
    }

    private fun isTrezor(dev: UsbDevice): Boolean {
        // Trezor vendor ids commonly seen: 0x1209 (4617), SatoshiLabs 0x534C? Also 0x21324 in some mappings.
        val knownVendors = setOf(0x1209, 0x534C, 21324)
        return knownVendors.contains(dev.vendorId)
    }
}
