import Foundation
import Observation
import RideData

/// The rider's profile as the app reads and edits it. Edits are saved as they are made, and a
/// value outside its allowed range is ignored.
@Observable
final class RiderProfileStore {
  private(set) var profile: RiderProfile
  @ObservationIgnored private let defaults: UserDefaults?

  /// Loads from `defaults` and saves back to it.
  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
    profile = RiderProfile.load(from: defaults)
  }

  /// Holds `profile` in memory only, for previews and sample rides.
  init(profile: RiderProfile) {
    self.defaults = nil
    self.profile = profile
  }

  var maxHeartRate: Int? {
    get { profile.maxHeartRate }
    set {
      guard newValue.map(RiderProfile.maxHeartRateRange.contains) ?? true else { return }
      profile.maxHeartRate = newValue
      save()
    }
  }

  var ftp: Int? {
    get { profile.ftp }
    set {
      guard newValue.map(RiderProfile.ftpRange.contains) ?? true else { return }
      profile.ftp = newValue
      save()
    }
  }

  private func save() {
    if let defaults { profile.save(to: defaults) }
  }

  /// The profile the design's sample ride was shown with.
  static var sample: RiderProfileStore {
    RiderProfileStore(profile: RiderProfile(maxHeartRate: 186, ftp: 200))
  }
}
