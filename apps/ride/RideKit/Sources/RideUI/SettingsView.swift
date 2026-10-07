import RideData
import SwiftUI

/// The rider's thresholds and the zones calculated from them, for heart rate or power.
struct SettingsView: View {
  @State private var metric = ZoneMetric.heartRate

  var body: some View {
    Form {
      Section("Thresholds") {
        ForEach(Threshold.allCases.filter { $0.metric == metric }, id: \.self) {
          ThresholdField(threshold: $0)
        }
      }
      ZonesSection(metric: metric)
    }
    .formStyle(.grouped)
    .navigationTitle("Settings")
    .toolbar {
      ToolbarItem(placement: .principal) {
        Picker("Zones for", selection: $metric) {
          ForEach(ZoneMetric.allCases, id: \.self) { Text($0.title).tag($0) }
        }
        .pickerStyle(.segmented)
        .fixedSize()
      }
    }
  }
}

private struct ThresholdField: View {
  let threshold: Threshold
  @Environment(RiderProfileStore.self) private var profile

  var body: some View {
    @Bindable var profile = profile
    LabeledContent {
      HStack(spacing: 6) {
        TextField(
          threshold.title, value: $profile[threshold], format: .number.grouping(.never),
          prompt: Text("Not set")
        )
        .labelsHidden()
        .multilineTextAlignment(.trailing)
        .frame(maxWidth: 80)
        #if os(iOS)
          .keyboardType(.numberPad)
        #endif
        Text(threshold.unit).foregroundStyle(.secondary)
      }
    } label: {
      Text(threshold.title)
      Text(threshold.help)
    }
  }
}

/// The zone model menu and the zones it gives, with each zone's top editable.
private struct ZonesSection: View {
  let metric: ZoneMetric
  @Environment(RiderProfileStore.self) private var profile

  private var choice: ZoneChoice { profile.zoneChoice(for: metric) }

  var body: some View {
    Section {
      Picker(selection: model) {
        ForEach(ZoneModel.groups(for: metric), id: \.title) { group in
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
      if choice.isCustom {
        Button("Restore \(choice.model.name) zones") { profile.choose(choice.model) }
      }
      if let zones = profile.zones(for: metric) {
        ZoneScale(zones: zones, range: scaleRange(of: zones), unit: unit)
        ZoneTableHeader(reference: choice.model.basis.reference)
        ForEach(zones.zones, id: \.index) { zone in
          ZoneRow(metric: metric, zones: zones, zone: zone)
        }
      } else {
        let missing = profile.missingThresholds(for: metric)
        Text(
          missing.isEmpty
            ? "These thresholds are too close together to make zones."
            : "Add your \(missing.map(\.name).formatted(.list(type: .and))) to see these zones."
        )
        .foregroundStyle(.secondary)
      }
    } header: {
      Text("Zones")
    } footer: {
      Text(
        "Change any upper limit and the next zone starts from it. Changing a threshold recalculates every zone unless they are custom."
      )
    }
  }

  /// The chosen model, or nil when the zones are custom.
  private var model: Binding<ZoneModel?> {
    Binding(
      get: { choice.isCustom ? nil : choice.model },
      set: { if let model = $0 { profile.choose(model) } })
  }

  private var caption: String {
    if choice.isCustom { return "Custom limits, based on \(choice.model.menuTitle)" }
    let thresholds = choice.model.basis.thresholds.map(\.name)
    return "Uses your \(thresholds.formatted(.list(type: .and)))"
  }

  private var unit: String { metric == .power ? "W" : "bpm" }

  /// The values the scale spans: up to max heart rate, or 160% of FTP, when they are known.
  private func scaleRange(of zones: ZoneSet) -> ClosedRange<Int> {
    let top = zones.zones.last?.lowerLimit ?? 1
    switch metric {
    case .heartRate:
      let max = profile[.maxHeartRate] ?? top * 11 / 10
      let bottom = profile[.maxHeartRate].map { $0 / 2 } ?? zones.upperLimits[0] * 4 / 5
      return min(bottom, top - 1)...max
    case .power:
      return 0...(profile[.ftp].map { $0 * 8 / 5 } ?? top * 13 / 10)
    }
  }
}

/// A bar of the zones side by side, each as wide as the values it covers.
private struct ZoneScale: View {
  let zones: ZoneSet
  let range: ClosedRange<Int>
  let unit: String

  var body: some View {
    VStack(spacing: 4) {
      GeometryReader { proxy in
        let widths = zones.zones.map(width)
        let total = widths.reduce(0, +)
        HStack(spacing: 1) {
          ForEach(zones.zones, id: \.index) { zone in
            Rectangle()
              .fill(zone.color(in: zones))
              .frame(width: proxy.size.width * widths[zone.index] / total)
          }
        }
      }
      .frame(height: 10)
      .clipShape(.rect(cornerRadius: 3))
      HStack {
        Text("\(range.lowerBound) \(unit)")
        Spacer()
        Text("\(range.upperBound) \(unit)")
      }
      .font(.caption.monospacedDigit())
      .foregroundStyle(.secondary)
    }
    .accessibilityHidden(true)
  }

  /// The share of the scale `zone` covers, never less than a sliver so every zone shows.
  private func width(of zone: Zone) -> Double {
    let bottom = max(zone.lowerLimit, range.lowerBound)
    let top = zone.upperLimit.map { $0 + 1 } ?? max(range.upperBound, zone.lowerLimit + 1)
    return Double(max(1, top - bottom))
  }
}

private enum ZoneColumn {
  static let label: CGFloat = 22
  static let limit: CGFloat = 56
  static let percent: CGFloat = 96
}

private struct ZoneTableHeader: View {
  let reference: Threshold

  var body: some View {
    HStack(spacing: 10) {
      Text("Zone").padding(.leading, 18)
      Spacer()
      Text("From").frame(width: ZoneColumn.limit, alignment: .trailing)
      Text("–").hidden()
      Text("To").frame(width: ZoneColumn.limit, alignment: .leading)
      Text("% of \(reference.abbreviation)").frame(width: ZoneColumn.percent, alignment: .trailing)
    }
    .font(.caption)
    .foregroundStyle(.secondary)
  }
}

private struct ZoneRow: View {
  let metric: ZoneMetric
  let zones: ZoneSet
  let zone: Zone
  @Environment(RiderProfileStore.self) private var profile

  var body: some View {
    HStack(spacing: 10) {
      Circle().fill(zone.color(in: zones)).frame(width: 8, height: 8)
      Text(zone.label)
        .foregroundStyle(.secondary)
        .frame(width: ZoneColumn.label, alignment: .leading)
      Text(zone.name).lineLimit(1)
      Spacer(minLength: 0)
      Text("\(zone.lowerLimit)").frame(width: ZoneColumn.limit, alignment: .trailing)
      Text("–").foregroundStyle(.secondary)
      Group {
        if zone.upperLimit != nil {
          TextField("Top of \(zone.name)", value: upperLimit, format: .number.grouping(.never))
            .labelsHidden()
            .textFieldStyle(.roundedBorder)
            .multilineTextAlignment(.trailing)
            #if os(iOS)
              .keyboardType(.numberPad)
            #endif
        } else {
          Text("and up").foregroundStyle(.secondary)
        }
      }
      .frame(width: ZoneColumn.limit, alignment: .leading)
      Text(percentages)
        .foregroundStyle(.secondary)
        .frame(width: ZoneColumn.percent, alignment: .trailing)
    }
    .monospacedDigit()
  }

  private var upperLimit: Binding<Int> {
    Binding(
      get: { zone.upperLimit ?? 0 },
      set: { profile.setUpperLimit($0, ofZone: zone.index, for: metric) })
  }

  private var percentages: String {
    let basis = profile.zoneChoice(for: metric).model.basis
    guard let reference = profile[basis.reference], reference > 0 else { return "" }
    func percent(_ value: Int) -> Int {
      Int((Double(value) / Double(reference) * 100).rounded())
    }
    guard let upper = zone.upperLimit else { return "\(percent(zone.lowerLimit))% and up" }
    if zone.index == 0 { return "under \(percent(upper + 1))%" }
    return "\(percent(zone.lowerLimit))–\(percent(upper))%"
  }
}

extension ZoneMetric {
  fileprivate var title: String {
    switch self {
    case .heartRate: "Heart rate"
    case .power: "Power"
    }
  }
}

extension ZoneModel {
  fileprivate var menuTitle: String { "\(name) · \(zoneCount) zones" }
}

extension Threshold {
  fileprivate var title: String {
    switch self {
    case .lactateThresholdHeartRate: "Lactate threshold heart rate"
    case .maxHeartRate: "Max heart rate"
    case .restingHeartRate: "Resting heart rate"
    case .ftp: "Functional threshold power"
    }
  }

  fileprivate var help: String {
    switch self {
    case .lactateThresholdHeartRate:
      "Your average over the last 20 minutes of an all-out 30-minute effort"
    case .maxHeartRate: "The highest your heart rate reaches in an all-out effort"
    case .restingHeartRate: "Measured lying down, just after you wake up"
    case .ftp: "The power you could hold for about an hour"
    }
  }
}

#Preview {
  NavigationStack {
    SettingsView()
  }
  .environment(RiderProfileStore.sample)
}
