import Foundation

struct HealthWorkoutEntry: Equatable {
  let id: String
  let endDate: Date
  let writtenByRide: Bool

  static func isRide(_ bundleIdentifier: String, appBundleIdentifier: String) -> Bool {
    bundleIdentifier == appBundleIdentifier
      || bundleIdentifier.hasPrefix(appBundleIdentifier + ".")
  }
}
