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
    /// A phone is too narrow for the percentage column.
    private var showsPercentages: Bool { sizeClass != .compact }
  #else
    private let showsPercentages = true
  #endif

  private var settings: MetricZones? { store.current.settings(for: metric, in: scope) }

  private var isEditable: Bool {
    guard let sport = scope.sport else { return true }
    return !store.current.usesDefault(metric, in: sport)
  }

  var body: some View {
    if let settings {
      Section {
        modelRow(settings.choice)
        if isEditable, settings.choice.isCustom {
          Button("Restore \(settings.choice.model.name) zones") {
            store.choose(settings.choice.model, in: scope)
          }
        }
        if let zones = settings.zones {
          ZoneScale(
            zones: zones, range: scaleRange(of: zones, thresholds: settings.thresholds),
            metric: metric, sport: scope.sport)
          ZoneTableHeader(
            reference: settings.choice.model.basis.reference, showsPercentages: showsPercentages)
          ForEach(zones.zones, id: \.index) { zone in
            ZoneRow(
              zones: zones, zone: zone, metric: metric, scope: scope, isEditable: isEditable,
              reference: showsPercentages
                ? settings.thresholds[settings.choice.model.basis.reference] : nil)
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

  @ViewBuilder private func modelRow(_ choice: ZoneChoice) -> some View {
    let caption =
      choice.isCustom
      ? "Custom limits, based on \(choice.model.menuTitle)"
      : "Uses your \(choice.model.basis.thresholds.map(\.name).formatted(.list(type: .and)))"
    if isEditable {
      Picker(selection: model(choice)) {
        ForEach(ZoneModel.groups(for: metric, in: scope.sport), id: \.title) { group in
          Section(group.title) {
            ForEach(group.models, id: \.self) { Text($0.menuTitle).tag(Optional($0)) }
          }
        }
        if choice.isCustom {
          Text("Custom").tag(ZoneModel?.none)
        }
      } label: {
        Text("Zone model")
        Text(caption)
      }
    } else {
      LabeledContent {
        Text(choice.isCustom ? "Custom" : choice.model.menuTitle)
      } label: {
        Text("Zone model")
        Text(caption)
      }
    }
  }

  /// The chosen model, or nil when the zones are custom.
  private func model(_ choice: ZoneChoice) -> Binding<ZoneModel?> {
    Binding(
      get: { choice.isCustom ? nil : choice.model },
      set: { if let model = $0 { store.choose(model, in: scope) } })
  }

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

/// A bar of the zones side by side, each as wide as the values it covers.
private struct ZoneScale: View {
  let zones: ZoneSet
  /// The easiest and hardest values shown.
  let range: (easiest: Int, hardest: Int)
  let metric: ZoneMetric
  let sport: Sport?

  var body: some View {
    VStack(spacing: 4) {
      GeometryReader { proxy in
        let widths = zones.zones.map(width)
        let total = widths.reduce(0, +)
        HStack(spacing: 1) {
          ForEach(zones.zones, id: \.index) { zone in
            Rectangle()
              .fill(zone.color)
              .frame(width: proxy.size.width * widths[zone.index] / total)
          }
        }
      }
      .frame(height: 10)
      .clipShape(.rect(cornerRadius: 3))
      HStack {
        Text(label(range.easiest))
        Spacer()
        Text(label(range.hardest))
      }
      .font(.caption.monospacedDigit())
      .foregroundStyle(.secondary)
    }
    .accessibilityHidden(true)
  }

  private func label(_ value: Int) -> String {
    "\(metric.format(value)) \(metric.unit(in: sport))"
  }

  /// The share of the scale `zone` covers, never less than a sliver so every zone shows. Pace
  /// is flipped so that harder is always further along.
  private func width(of zone: Zone) -> Double {
    let sign = zones.isDescending ? -1 : 1
    let low = sign * range.easiest
    let high = sign * range.hardest
    let start = zone.start.map { max(sign * $0, low) } ?? low
    let end = zone.end.map { sign * $0 + 1 } ?? max(high, start + 1)
    return Double(max(1, end - start))
  }
}

private enum ZoneColumn {
  static let label: CGFloat = 22
  static let limit: CGFloat = 60
  static let percent: CGFloat = 104
}

private struct ZoneTableHeader: View {
  let reference: Threshold
  let showsPercentages: Bool

  var body: some View {
    HStack(spacing: 10) {
      Text("Zone").padding(.leading, 18)
      Spacer()
      Text("From").frame(width: ZoneColumn.limit, alignment: .trailing)
      Text("–").hidden()
      Text("To").frame(width: ZoneColumn.limit, alignment: .leading)
      if showsPercentages {
        Text("% of \(reference.abbreviation)")
          .frame(width: ZoneColumn.percent, alignment: .trailing)
      }
    }
    .font(.caption)
    .foregroundStyle(.secondary)
  }
}

private struct ZoneRow: View {
  let zones: ZoneSet
  let zone: Zone
  let metric: ZoneMetric
  let scope: ZoneScope
  let isEditable: Bool
  /// The threshold value percentages are shown against, or nil to show none.
  let reference: Int?
  @Environment(RiderSettingsStore.self) private var store

  var body: some View {
    HStack(spacing: 10) {
      Circle().fill(zone.color).frame(width: 8, height: 8)
      Text(zone.label)
        .foregroundStyle(.secondary)
        .frame(width: ZoneColumn.label, alignment: .leading)
      Text(zone.name).lineLimit(1)
      Spacer(minLength: 0)
      Group {
        if let start = zone.start {
          Text(metric.format(start))
        } else {
          Text(zones.isDescending ? "slower" : "0").foregroundStyle(.secondary)
        }
      }
      .frame(width: ZoneColumn.limit, alignment: .trailing)
      Text("–").foregroundStyle(.secondary)
      Group {
        if let end = zone.end {
          if isEditable {
            endField(end)
          } else {
            Text(metric.format(end))
          }
        } else {
          Text(zones.isDescending ? "faster" : "and up").foregroundStyle(.secondary)
        }
      }
      .frame(width: ZoneColumn.limit, alignment: .leading)
      if let reference {
        Text(percentages(of: reference))
          .foregroundStyle(.secondary)
          .frame(width: ZoneColumn.percent, alignment: .trailing)
      }
    }
    .monospacedDigit()
  }

  @ViewBuilder private func endField(_ end: Int) -> some View {
    let value = Binding(
      get: { end },
      set: { store.setLimit($0, ofZone: zone.index, for: metric, in: scope) })
    Group {
      if metric == .pace {
        TextField("End of \(zone.name)", value: value, format: .pace)
      } else {
        TextField("End of \(zone.name)", value: value, format: .number.grouping(.never))
          #if os(iOS)
            .keyboardType(.numberPad)
          #endif
      }
    }
    .labelsHidden()
    .textFieldStyle(.roundedBorder)
    .multilineTextAlignment(.trailing)
  }

  private func percentages(of reference: Int) -> String {
    guard reference > 0 else { return "" }
    func percent(_ value: Int) -> Int {
      Int((Double(value) / Double(reference) * 100).rounded())
    }
    let (easier, harder) = zones.isDescending ? ("over", "and faster") : ("under", "and up")
    guard let start = zone.start else {
      return zones.zones[1].start.map { "\(easier) \(percent($0))%" } ?? ""
    }
    guard let end = zone.end else { return "\(percent(start))% \(harder)" }
    let (low, high) = zones.isDescending ? (end, start) : (start, end)
    return "\(percent(low))–\(percent(high))%"
  }
}
