import RideData
import SwiftUI

/// A choice between the ways of breaking down a ride, and the chosen breakdown.
struct RideBreakdownSection: View {
  let recording: RideRecording
  @State private var choice: RideBreakdown?
  @Environment(RiderSettingsStore.self) private var store

  var body: some View {
    let available = RideBreakdown.allCases.filter { $0.isAvailable(for: recording) }
    if let shown = choice ?? available.first {
      let caption = basis(of: shown).map { Text($0).font(.caption).foregroundStyle(.secondary) }
      VStack(alignment: .leading, spacing: 14) {
        // Side by side with room to spare, otherwise stacked, and as a menu on a narrow phone.
        ViewThatFits(in: .horizontal) {
          HStack {
            picker(available).pickerStyle(.segmented).fixedSize()
            Spacer()
            caption
          }
          VStack(alignment: .leading, spacing: 6) {
            picker(available).pickerStyle(.segmented).fixedSize()
            caption
          }
          VStack(alignment: .leading, spacing: 6) {
            picker(available).pickerStyle(.menu).fixedSize()
            caption
          }
        }
        switch shown {
        case .powerZones: ZoneBreakdown(recording: recording, metric: .power)
        case .heartRateZones: ZoneBreakdown(recording: recording, metric: .heartRate)
        case .paceZones: ZoneBreakdown(recording: recording, metric: .pace)
        case .powerCurve: PowerCurveChart(points: recording.powerCurve())
        }
      }
      // A ride without the chosen breakdown shows the first with what it needs from the
      // rider's profile instead.
      .onChange(of: available, initial: true) { _, available in
        if let choice, available.contains(choice) { return }
        choice = available.first(where: isConfigured) ?? available.first
      }
    }
  }

  private func picker(_ available: [RideBreakdown]) -> some View {
    Picker("Breakdown", selection: $choice) {
      ForEach(available) { Text($0.title).tag(Optional($0)) }
    }
    .labelsHidden()
  }

  private func isConfigured(_ breakdown: RideBreakdown) -> Bool {
    guard let metric = breakdown.metric else { return true }
    return store.zones(for: metric, of: recording) != nil
  }

  /// What the zones of `breakdown` come from, such as `Zones from FTP 200 W`.
  private func basis(of breakdown: RideBreakdown) -> LocalizedStringResource? {
    guard let metric = breakdown.metric,
      let settings = store.settings(for: metric, of: recording), settings.zones != nil
    else { return nil }
    if settings.choice.isCustom { return "Custom zones" }
    let values = settings.choice.model.basis.thresholds.compactMap { threshold in
      settings.thresholds[threshold].map {
        "\(threshold.abbreviation) \(metric.format($0)) \(metric.unit(in: recording.sport))"
      }
    }
    return "Zones from \(values.formatted(.list(type: .and)))"
  }
}

#Preview {
  if let ride = try? RideRecording.sample() {
    RideBreakdownSection(recording: ride)
      .environment(RiderSettingsStore.sample)
      .padding()
  }
}
