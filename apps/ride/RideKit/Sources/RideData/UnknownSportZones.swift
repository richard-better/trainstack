import Foundation

struct UnknownSportZones: Equatable, Sendable {
  var thresholds: [String: Int]
  var model: String
  var customLimits: [Int]?

  init(copying zones: MetricZones) {
    thresholds = Dictionary(
      uniqueKeysWithValues: zones.thresholds.map { ($0.key.wireName, $0.value) })
    model = zones.choice.model.wireName
    customLimits = zones.choice.customLimits
  }
}
