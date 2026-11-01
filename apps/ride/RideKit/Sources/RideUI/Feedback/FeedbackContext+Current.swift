import Foundation
import RideStrava

#if canImport(UIKit)
  import UIKit
#endif

extension FeedbackContext {
  /// What this copy of Ride is running on, with the `screen` the rider was on and the `window`
  /// size it had.
  static func current(screen: String, window: CGSize?) -> FeedbackContext {
    FeedbackContext(
      app: appVersion, system: systemVersion, device: deviceModel, screen: screen,
      window: window.map { "\(Int($0.width.rounded()))×\(Int($0.height.rounded()))" })
  }

  private static var appVersion: String {
    let info = Bundle.main.infoDictionary ?? [:]
    let version = info["CFBundleShortVersionString"] as? String ?? "?"
    let build = info["CFBundleVersion"] as? String ?? "?"
    return "Ride \(version) (\(build))"
  }

  private static var systemVersion: String {
    #if os(macOS)
      let version = ProcessInfo.processInfo.operatingSystemVersion
      return "macOS \(version.majorVersion).\(version.minorVersion).\(version.patchVersion)"
    #else
      return "\(UIDevice.current.systemName) \(UIDevice.current.systemVersion)"
    #endif
  }

  /// The model identifier, like `iPhone18,1` or `Mac16,10`, which says more than the marketing
  /// name the system offers.
  private static var deviceModel: String? {
    #if targetEnvironment(simulator)
      return ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"].map {
        "\($0) (Simulator)"
      }
    #elseif os(macOS)
      var size = 0
      guard sysctlbyname("hw.model", nil, &size, nil, 0) == 0, size > 0 else { return nil }
      var model = [CChar](repeating: 0, count: size)
      guard sysctlbyname("hw.model", &model, &size, nil, 0) == 0 else { return nil }
      return String(decoding: model.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) }, as: UTF8.self)
    #else
      var system = utsname()
      uname(&system)
      return withUnsafeBytes(of: &system.machine) { bytes in
        String(decoding: bytes.prefix { $0 != 0 }, as: UTF8.self)
      }
    #endif
  }
}
