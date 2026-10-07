import RideData
import SwiftUI

/// A scope's zones for one metric: the model menu and the zones it gives, with the end of each
/// zone editable. Read-only for a sport that uses Default's zones.
struct ZonesSection: View {
  let scope: ZoneScope
  let metric: ZoneMetric
  @Environment(RiderSettingsStore.self) private var store
  #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
    /// A phone is too narrow for a percentage column, so there they go under each zone's name.
    private var hasPercentColumn: Bool { sizeClass == .regular }
  #else
    private let hasPercentColumn = true
  #endif

  private var settings: MetricZones? { store.current.settings(for: metric, in: scope) }

  private var isEditable: Bool {
    guard let sport = scope.sport else { return true }
    return !store.current.usesDefault(metric, in: sport)
  }

  var body: some View {
    if let settings {
      Section {
        ZoneModelRow(
          scope: scope, metric: metric, choice: settings.choice, isEditable: isEditable)
        if isEditable, settings.choice.isCustom {
          Button("Restore \(settings.choice.model.name) zones") { restore(settings.choice.model) }
        }
        if let zones = settings.zones {
          ZoneScale(
            zones: zones, range: scaleRange(of: zones, thresholds: settings.thresholds),
            metric: metric, sport: scope.sport)
          ZoneTableHeader(
            reference: settings.choice.model.basis.reference, hasPercentColumn: hasPercentColumn)
          ForEach(zones.zones) { zone in
            ZoneRow(
              zones: zones, zone: zone, metric: metric, scope: scope, isEditable: isEditable,
              reference: settings.thresholds[settings.choice.model.basis.reference],
              hasPercentColumn: hasPercentColumn)
          }
        } else {
          let missing = settings.missingThresholds
          Text(
            missing.isEmpty
              ? "These thresholds leave no room for every zone. Check that they are in order."
              : "Add your \(missing.map(\.name).formatted(.list(type: .and))) to see these zones."
          )
          .foregroundStyle(.secondary)
        }
      } header: {
        Text(isEditable ? "Zones" : "Default zones")
      } footer: {
        if isEditable {
          Text(
            "Change where a zone ends and the next zone starts from it. Changing a threshold recalculates every zone unless they are custom."
          )
        }
      }
    }
  }

  private func restore(_ model: ZoneModel) { store.choose(model, in: scope) }

  /// The values the scale spans, from easiest to hardest: from half to all of max heart rate,
  /// up to 160% of FTP, or from 140% to 85% of threshold pace, when those are known.
  private func scaleRange(of zones: ZoneSet, thresholds: [Threshold: Int]) -> (Int, Int) {
    let firstEnd = zones.limits[0]
    let lastStart = zones.zones.last?.start ?? firstEnd
    switch metric {
    case .heartRate:
      if let max = thresholds[.maxHeartRate] { return (min(max / 2, firstEnd), max) }
      return (firstEnd * 4 / 5, lastStart * 11 / 10)
    case .power:
      return (0, thresholds[.ftp].map { $0 * 8 / 5 } ?? lastStart * 13 / 10)
    case .pace:
      if let pace = thresholds[.thresholdPace] {
        return (max(pace * 7 / 5, firstEnd + 1), min(pace * 17 / 20, lastStart - 1))
      }
      return (firstEnd * 11 / 10, lastStart * 9 / 10)
    }
  }
}
