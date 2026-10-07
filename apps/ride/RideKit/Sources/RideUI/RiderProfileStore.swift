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

  subscript(threshold: Threshold) -> Int? {
    get { profile[threshold] }
    set {
      profile[threshold] = newValue
      save()
    }
  }

  var ftp: Int? { profile.ftp }

  func zones(for metric: ZoneMetric) -> ZoneSet? { profile.zones(for: metric) }

  func zoneChoice(for metric: ZoneMetric) -> ZoneChoice { profile.zoneChoice(for: metric) }

  func missingThresholds(for metric: ZoneMetric) -> [Threshold] {
    profile.missingThresholds(for: metric)
  }

  /// Follows `model`, dropping any custom limits.
  func choose(_ model: ZoneModel) {
    profile.setZoneChoice(ZoneChoice(model: model), for: model.metric)
    save()
  }

  /// Moves the top of a zone, which makes the zones custom. Ignored when it would empty a zone.
  func setUpperLimit(_ limit: Int, ofZone index: Int, for metric: ZoneMetric) {
    guard let limits = zones(for: metric)?.upperLimits(settingZone: index, upperLimitTo: limit)
    else { return }
    var choice = zoneChoice(for: metric)
    choice.customUpperLimits = limits
    profile.setZoneChoice(choice, for: metric)
    save()
  }

  private func save() {
    if let defaults { profile.save(to: defaults) }
  }

  /// The profile the design's sample ride was shown with.
  static var sample: RiderProfileStore {
    RiderProfileStore(profile: RiderProfile(maxHeartRate: 186, ftp: 200))
  }
}
