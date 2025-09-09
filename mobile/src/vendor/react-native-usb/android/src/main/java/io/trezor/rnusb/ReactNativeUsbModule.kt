package io.trezor.rnusb

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.*
import android.os.Build
import android.util.Log
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import kotlinx.coroutines.*
import java.util.concurrent.ConcurrentHashMap

class ReactNativeUsbModule : Module() {
    companion object {
        private const val TAG = "ReactNativeUsbModule"
        private const val USB_PERMISSION = "io.trezor.rnusb.USB_PERMISSION"
    }

    private var usbManager: UsbManager? = null
    private val connectedDevices = ConcurrentHashMap<String, UsbDevice>()
    private val openedDevices = ConcurrentHashMap<String, UsbDeviceConnection>()
    private val claimedInterfaces = ConcurrentHashMap<String, MutableSet<UsbInterface>>()
    private val permissionPromises = ConcurrentHashMap<String, Promise>()
    private var priorityMode = false

    private val usbPermissionReceiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            val action = intent.action
            if (USB_PERMISSION == action) {
                synchronized(this) {
                    val device: UsbDevice? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        intent.getParcelableExtra(UsbManager.EXTRA_DEVICE, UsbDevice::class.java)
                    } else {
                        @Suppress("DEPRECATION")
                        intent.getParcelableExtra(UsbManager.EXTRA_DEVICE)
                    }

                    if (device != null) {
                        val deviceKey = getDeviceKey(device)
                        val promise = permissionPromises.remove(deviceKey)

                        if (intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)) {
                            Log.d(TAG, "USB permission granted for device: ${device.deviceName}")
                            promise?.resolve(true)
                        } else {
                            Log.w(TAG, "USB permission denied for device: ${device.deviceName}")
                            promise?.reject("PERMISSION_DENIED", "USB permission denied", null)
                        }
                    }
                }
            }
        }
    }

    override fun definition() = ModuleDefinition {
        Name("ReactNativeUsb")

        OnCreate {
            usbManager = appContext.reactContext?.getSystemService(Context.USB_SERVICE) as? UsbManager
            
            // Register permission receiver
            val filter = IntentFilter(USB_PERMISSION)
            appContext.reactContext?.registerReceiver(usbPermissionReceiver, filter)
            
            Log.d(TAG, "ReactNativeUsbModule created")
        }

        OnDestroy {
            try {
                appContext.reactContext?.unregisterReceiver(usbPermissionReceiver)
            } catch (e: Exception) {
                Log.w(TAG, "Error unregistering receiver: ${e.message}")
            }
        }

        AsyncFunction("getDevices") { promise: Promise ->
            CoroutineScope(Dispatchers.IO).launch {
                try {
                    val devices = usbManager?.deviceList?.values?.map { device ->
                        mapOf(
                            "deviceClass" to device.deviceClass,
                            "deviceSubclass" to device.deviceSubclass,
                            "deviceProtocol" to device.deviceProtocol,
                            "vendorId" to device.vendorId,
                            "productId" to device.productId,
                            "deviceVersionMajor" to ((device.deviceVersionMajor shr 8) and 0xFF),
                            "deviceVersionMinor" to (device.deviceVersionMajor and 0xFF),
                            "deviceVersionSubminor" to device.deviceVersionMinor,
                            "manufacturerName" to device.manufacturerName,
                            "productName" to device.productName,
                            "serialNumber" to device.serialNumber
                        )
                    } ?: emptyList()
                    
                    withContext(Dispatchers.Main) {
                        promise.resolve(devices)
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error getting devices", e)
                    withContext(Dispatchers.Main) {
                        promise.reject("GET_DEVICES_ERROR", e.message, e)
                    }
                }
            }
        }

        AsyncFunction("open") { deviceInfo: Map<String, Any>, promise: Promise ->
            CoroutineScope(Dispatchers.IO).launch {
                try {
                    val device = findDevice(deviceInfo)
                    if (device == null) {
                        withContext(Dispatchers.Main) {
                            promise.reject("DEVICE_NOT_FOUND", "Device not found", null)
                        }
                        return@launch
                    }

                    val deviceKey = getDeviceKey(device)
                    
                    // Check if device is already opened
                    if (openedDevices.containsKey(deviceKey)) {
                        Log.d(TAG, "Device already opened: ${device.deviceName}")
                        withContext(Dispatchers.Main) {
                            promise.resolve(true)
                        }
                        return@launch
                    }

                    // Check permission
                    if (!usbManager!!.hasPermission(device)) {
                        requestPermission(device, promise)
                        return@launch
                    }

                    // Open device
                    val connection = usbManager!!.openDevice(device)
                    if (connection != null) {
                        openedDevices[deviceKey] = connection
                        connectedDevices[deviceKey] = device
                        claimedInterfaces[deviceKey] = mutableSetOf()
                        Log.d(TAG, "Device opened successfully: ${device.deviceName}")
                        withContext(Dispatchers.Main) {
                            promise.resolve(true)
                        }
                    } else {
                        withContext(Dispatchers.Main) {
                            promise.reject("OPEN_FAILED", "Failed to open device", null)
                        }
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error opening device", e)
                    withContext(Dispatchers.Main) {
                        promise.reject("OPEN_ERROR", e.message, e)
                    }
                }
            }
        }

        AsyncFunction("close") { deviceInfo: Map<String, Any>, promise: Promise ->
            CoroutineScope(Dispatchers.IO).launch {
                try {
                    if (priorityMode) {
                        Log.d(TAG, "Priority mode enabled, skipping device close")
                        withContext(Dispatchers.Main) {
                            promise.resolve(true)
                        }
                        return@launch
                    }

                    val device = findDevice(deviceInfo)
                    if (device == null) {
                        withContext(Dispatchers.Main) {
                            promise.reject("DEVICE_NOT_FOUND", "Device not found", null)
                        }
                        return@launch
                    }

                    val deviceKey = getDeviceKey(device)
                    val connection = openedDevices.remove(deviceKey)
                    
                    // Release all claimed interfaces
                    claimedInterfaces[deviceKey]?.forEach { iface ->
                        try {
                            connection?.releaseInterface(iface)
                        } catch (e: Exception) {
                            Log.w(TAG, "Error releasing interface: ${e.message}")
                        }
                    }
                    claimedInterfaces.remove(deviceKey)
                    
                    connection?.close()
                    connectedDevices.remove(deviceKey)
                    
                    Log.d(TAG, "Device closed: ${device.deviceName}")
                    withContext(Dispatchers.Main) {
                        promise.resolve(true)
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error closing device", e)
                    withContext(Dispatchers.Main) {
                        promise.reject("CLOSE_ERROR", e.message, e)
                    }
                }
            }
        }

        AsyncFunction("reset") { deviceInfo: Map<String, Any>, promise: Promise ->
            CoroutineScope(Dispatchers.IO).launch {
                try {
                    val device = findDevice(deviceInfo)
                    if (device == null) {
                        withContext(Dispatchers.Main) {
                            promise.reject("DEVICE_NOT_FOUND", "Device not found", null)
                        }
                        return@launch
                    }

                    val deviceKey = getDeviceKey(device)
                    val connection = openedDevices[deviceKey]
                    
                    if (connection == null) {
                        withContext(Dispatchers.Main) {
                            promise.reject("DEVICE_NOT_OPENED", "Device not opened", null)
                        }
                        return@launch
                    }

                    // Close and reopen the device (simulates reset)
                    connection.close()
                    openedDevices.remove(deviceKey)
                    
                    // Reopen
                    val newConnection = usbManager!!.openDevice(device)
                    if (newConnection != null) {
                        openedDevices[deviceKey] = newConnection
                        Log.d(TAG, "Device reset successfully: ${device.deviceName}")
                        withContext(Dispatchers.Main) {
                            promise.resolve(true)
                        }
                    } else {
                        withContext(Dispatchers.Main) {
                            promise.reject("RESET_FAILED", "Failed to reset device", null)
                        }
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error resetting device", e)
                    withContext(Dispatchers.Main) {
                        promise.reject("RESET_ERROR", e.message, e)
                    }
                }
            }
        }

        AsyncFunction("claimInterface") { deviceInfo: Map<String, Any>, interfaceNumber: Int, promise: Promise ->
            CoroutineScope(Dispatchers.IO).launch {
                try {
                    val device = findDevice(deviceInfo)
                    if (device == null) {
                        withContext(Dispatchers.Main) {
                            promise.reject("DEVICE_NOT_FOUND", "Device not found", null)
                        }
                        return@launch
                    }

                    val deviceKey = getDeviceKey(device)
                    val connection = openedDevices[deviceKey]
                    
                    if (connection == null) {
                        withContext(Dispatchers.Main) {
                            promise.reject("DEVICE_NOT_OPENED", "Device not opened", null)
                        }
                        return@launch
                    }

                    val usbInterface = device.getInterface(interfaceNumber)
                    if (usbInterface == null) {
                        withContext(Dispatchers.Main) {
                            promise.reject("INTERFACE_NOT_FOUND", "Interface not found", null)
                        }
                        return@launch
                    }

                    val success = connection.claimInterface(usbInterface, true)
                    if (success) {
                        claimedInterfaces.getOrPut(deviceKey) { mutableSetOf() }.add(usbInterface)
                        Log.d(TAG, "Interface claimed: $interfaceNumber")
                        withContext(Dispatchers.Main) {
                            promise.resolve(true)
                        }
                    } else {
                        withContext(Dispatchers.Main) {
                            promise.reject("CLAIM_FAILED", "Failed to claim interface", null)
                        }
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error claiming interface", e)
                    withContext(Dispatchers.Main) {
                        promise.reject("CLAIM_ERROR", e.message, e)
                    }
                }
            }
        }

        AsyncFunction("releaseInterface") { deviceInfo: Map<String, Any>, interfaceNumber: Int, promise: Promise ->
            CoroutineScope(Dispatchers.IO).launch {
                try {
                    val device = findDevice(deviceInfo)
                    if (device == null) {
                        withContext(Dispatchers.Main) {
                            promise.reject("DEVICE_NOT_FOUND", "Device not found", null)
                        }
                        return@launch
                    }

                    val deviceKey = getDeviceKey(device)
                    val connection = openedDevices[deviceKey]
                    
                    if (connection == null) {
                        withContext(Dispatchers.Main) {
                            promise.reject("DEVICE_NOT_OPENED", "Device not opened", null)
                        }
                        return@launch
                    }

                    val usbInterface = device.getInterface(interfaceNumber)
                    if (usbInterface != null) {
                        val success = connection.releaseInterface(usbInterface)
                        if (success) {
                            claimedInterfaces[deviceKey]?.remove(usbInterface)
                            Log.d(TAG, "Interface released: $interfaceNumber")
                        }
                    }
                    
                    withContext(Dispatchers.Main) {
                        promise.resolve(true)
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error releasing interface", e)
                    withContext(Dispatchers.Main) {
                        promise.reject("RELEASE_ERROR", e.message, e)
                    }
                }
            }
        }

        AsyncFunction("transferIn") { deviceInfo: Map<String, Any>, endpointNumber: Int, length: Int, promise: Promise ->
            CoroutineScope(Dispatchers.IO).launch {
                try {
                    val device = findDevice(deviceInfo)
                    if (device == null) {
                        withContext(Dispatchers.Main) {
                            promise.reject("DEVICE_NOT_FOUND", "Device not found", null)
                        }
                        return@launch
                    }

                    val deviceKey = getDeviceKey(device)
                    val connection = openedDevices[deviceKey]
                    
                    if (connection == null) {
                        withContext(Dispatchers.Main) {
                            promise.reject("DEVICE_NOT_OPENED", "Device not opened", null)
                        }
                        return@launch
                    }

                    val buffer = ByteArray(length)
                    val bytesRead = connection.bulkTransfer(
                        findEndpoint(device, endpointNumber, UsbConstants.USB_DIR_IN),
                        buffer,
                        length,
                        5000 // 5 second timeout
                    )

                    if (bytesRead >= 0) {
                        val result = mapOf(
                            "data" to buffer.take(bytesRead),
                            "bytesRead" to bytesRead
                        )
                        withContext(Dispatchers.Main) {
                            promise.resolve(result)
                        }
                    } else {
                        withContext(Dispatchers.Main) {
                            promise.reject("TRANSFER_FAILED", "Transfer failed with code: $bytesRead", null)
                        }
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error in transferIn", e)
                    withContext(Dispatchers.Main) {
                        promise.reject("TRANSFER_ERROR", e.message, e)
                    }
                }
            }
        }

        AsyncFunction("transferOut") { deviceInfo: Map<String, Any>, endpointNumber: Int, data: List<Int>, promise: Promise ->
            CoroutineScope(Dispatchers.IO).launch {
                try {
                    val device = findDevice(deviceInfo)
                    if (device == null) {
                        withContext(Dispatchers.Main) {
                            promise.reject("DEVICE_NOT_FOUND", "Device not found", null)
                        }
                        return@launch
                    }

                    val deviceKey = getDeviceKey(device)
                    val connection = openedDevices[deviceKey]
                    
                    if (connection == null) {
                        withContext(Dispatchers.Main) {
                            promise.reject("DEVICE_NOT_OPENED", "Device not opened", null)
                        }
                        return@launch
                    }

                    val buffer = data.map { it.toByte() }.toByteArray()
                    val bytesWritten = connection.bulkTransfer(
                        findEndpoint(device, endpointNumber, UsbConstants.USB_DIR_OUT),
                        buffer,
                        buffer.size,
                        5000 // 5 second timeout
                    )

                    if (bytesWritten >= 0) {
                        val result = mapOf(
                            "bytesWritten" to bytesWritten
                        )
                        withContext(Dispatchers.Main) {
                            promise.resolve(result)
                        }
                    } else {
                        withContext(Dispatchers.Main) {
                            promise.reject("TRANSFER_FAILED", "Transfer failed with code: $bytesWritten", null)
                        }
                    }
                } catch (e: Exception) {
                    Log.e(TAG, "Error in transferOut", e)
                    withContext(Dispatchers.Main) {
                        promise.reject("TRANSFER_ERROR", e.message, e)
                    }
                }
            }
        }

        Function("setPriorityMode") { enabled: Boolean ->
            priorityMode = enabled
            Log.d(TAG, "Priority mode set to: $enabled")
        }
    }

    private fun findDevice(deviceInfo: Map<String, Any>): UsbDevice? {
        val vendorId = deviceInfo["vendorId"] as? Int ?: return null
        val productId = deviceInfo["productId"] as? Int ?: return null
        
        return usbManager?.deviceList?.values?.find { device ->
            device.vendorId == vendorId && device.productId == productId
        }
    }

    private fun getDeviceKey(device: UsbDevice): String {
        return "${device.vendorId}-${device.productId}-${device.serialNumber ?: "unknown"}"
    }

    private fun findEndpoint(device: UsbDevice, endpointNumber: Int, direction: Int): UsbEndpoint? {
        for (i in 0 until device.interfaceCount) {
            val usbInterface = device.getInterface(i)
            for (j in 0 until usbInterface.endpointCount) {
                val endpoint = usbInterface.getEndpoint(j)
                if (endpoint.endpointNumber == endpointNumber && 
                    (endpoint.direction and UsbConstants.USB_ENDPOINT_DIR_MASK) == direction) {
                    return endpoint
                }
            }
        }
        return null
    }

    private fun requestPermission(device: UsbDevice, promise: Promise) {
        val deviceKey = getDeviceKey(device)
        permissionPromises[deviceKey] = promise
        
        val permissionIntent = PendingIntent.getBroadcast(
            appContext.reactContext,
            0,
            Intent(USB_PERMISSION),
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            } else {
                PendingIntent.FLAG_UPDATE_CURRENT
            }
        )
        
        usbManager?.requestPermission(device, permissionIntent)
    }
}