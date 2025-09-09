import ExpoModulesCore

public class ReactNativeUsbModule: Module {
  // This file is mostly empty because we don't support iOS/Mac (yet).

  public func definition() -> ModuleDefinition {
    Name("ReactNativeUsb")

    // Define constants or static properties
    // Constants([:])

    // Define events
    // Events("onReactNativeUsbEvent")

    // Define asynchronous functions
    AsyncFunction("getDevices") { (promise: Promise) in
      // iOS doesn't support USB host mode, return empty array
      promise.resolve([])
    }

    AsyncFunction("open") { (deviceInfo: [String: Any], promise: Promise) in
      promise.reject("NOT_SUPPORTED", "USB not supported on iOS", nil)
    }

    AsyncFunction("close") { (deviceInfo: [String: Any], promise: Promise) in
      promise.reject("NOT_SUPPORTED", "USB not supported on iOS", nil)
    }

    AsyncFunction("reset") { (deviceInfo: [String: Any], promise: Promise) in
      promise.reject("NOT_SUPPORTED", "USB not supported on iOS", nil)
    }

    AsyncFunction("claimInterface") { (deviceInfo: [String: Any], interfaceNumber: Int, promise: Promise) in
      promise.reject("NOT_SUPPORTED", "USB not supported on iOS", nil)
    }

    AsyncFunction("releaseInterface") { (deviceInfo: [String: Any], interfaceNumber: Int, promise: Promise) in
      promise.reject("NOT_SUPPORTED", "USB not supported on iOS", nil)
    }

    AsyncFunction("transferIn") { (deviceInfo: [String: Any], endpointNumber: Int, length: Int, promise: Promise) in
      promise.reject("NOT_SUPPORTED", "USB not supported on iOS", nil)
    }

    AsyncFunction("transferOut") { (deviceInfo: [String: Any], endpointNumber: Int, data: [Int], promise: Promise) in
      promise.reject("NOT_SUPPORTED", "USB not supported on iOS", nil)
    }

    Function("setPriorityMode") { (enabled: Bool) in
      // No-op on iOS
    }
  }
}