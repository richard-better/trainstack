import RideData
import SwiftUI

/// A finished ride: when it happened, the headline numbers, the effort over time, and zones.
struct ActivityDetailView: View {
  let ride: Ride
  var onRemove: () -> Void
  @State private var isExporting = false
  @State private var isConfirmingRemove = false
  @Environment(RiderSettingsStore.self) private var store

  private var recording: RideRecording { ride.recording }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 22) {
        VStack(alignment: .leading, spacing: 4) {
          Text(startLine).foregroundStyle(.secondary)
          Text(ride.title).font(.largeTitle.weight(.semibold))
        }
        StatsRow(stats: stats)
        if recording.hasPower || recording.hasHeartRate {
          ActivityChart(recording: recording)
        }
        ZoneSection(recording: recording)
      }
      .padding(.horizontal, 32)
      .padding(.vertical, 24)
      .frame(maxWidth: 900, alignment: .leading)
      .frame(maxWidth: .infinity)
    }
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        ShareLink(item: ride, preview: SharePreview(ride.title))
      }
      #if os(iOS)
        // Its actions join the system's own overflow menu rather than nesting in it.
        ToolbarOverflowMenu { moreActions }
      #else
        ToolbarItem {
          Menu("More", systemImage: "ellipsis") { moreActions }
        }
      #endif
    }
    // Attached outside the menu, which the system owns on iOS, so that it can present.
    .confirmationDialog("Remove this ride from History?", isPresented: $isConfirmingRemove) {
      Button("Remove Ride", role: .destructive, action: onRemove)
    } message: {
      Text("To get it back, open its FIT file again.")
    }
    .fileExporter(
      isPresented: $isExporting, document: FITDocument(data: ride.fileData),
      contentType: .fitFile, defaultFilename: ride.exportFileName
    ) { _ in }
  }

  @ViewBuilder private var moreActions: some View {
    Button("Export FIT…", systemImage: "square.and.arrow.down", action: export)
    Divider()
    Button("Remove from History", systemImage: "trash", role: .destructive, action: confirmRemove)
  }

  private func export() { isExporting = true }

  private func confirmRemove() { isConfirmingRemove = true }

  private var startLine: String {
    let date = recording.startDate.formatted(
      .dateTime.weekday(.wide).day().month(.wide).year())
    return "\(date) · \(recording.startDate.formatted(date: .omitted, time: .shortened))"
  }

  private var stats: [StatsRow.Stat] {
    let summary = recording.summary
    var result = [StatsRow.Stat(label: "Duration", value: summary.duration.clockString)]
    if let power = summary.averagePower {
      result.append(.init(label: "Avg power", value: "\(power)", unit: "W"))
    }
    if let heartRate = summary.averageHeartRate {
      result.append(.init(label: "Avg heart rate", value: "\(heartRate)", unit: "bpm"))
    }
    if let ftp = store.ftp(for: recording), let stress = recording.trainingStressScore(ftp: ftp) {
      result.append(.init(label: "Stress", value: "\(stress)", unit: "TSS"))
    }
    if let onTarget = recording.timeOnTarget() {
      result.append(
        .init(label: "On target", value: "\(Int((onTarget * 100).rounded()))", unit: "%"))
    }
    if let distance = summary.distance {
      result.append(
        .init(
          label: "Distance",
          value: (distance / 1000).formatted(.number.precision(.fractionLength(1))), unit: "km"))
    }
    return result
  }
}

private struct StatsRow: View {
  struct Stat: Identifiable {
    let label: String
    let value: String
    var unit: String?
    var id: String { label }
  }

  let stats: [Stat]

  var body: some View {
    HStack(spacing: 0) {
      ForEach(Array(stats.enumerated()), id: \.element.id) { index, stat in
        VStack(alignment: .leading, spacing: 3) {
          Text(stat.label).font(.caption).foregroundStyle(.secondary)
          HStack(alignment: .firstTextBaseline, spacing: 3) {
            Text(stat.value).font(.title2.weight(.medium))
            if let unit = stat.unit { Text(unit).font(.footnote).foregroundStyle(.secondary) }
          }
        }
        .monospacedDigit()
        .padding(.vertical, 12)
        .padding(.leading, index == 0 ? 0 : 16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay(alignment: .leading) {
          if index > 0 { Rectangle().fill(.separator).frame(width: 1) }
        }
        .accessibilityElement(children: .combine)
      }
    }
    .overlay(alignment: .top) { Divider() }
    .overlay(alignment: .bottom) { Divider() }
  }
}

#Preview {
  NavigationStack {
    if let ride = RideLibrary.sample().rides.first {
      ActivityDetailView(ride: ride) {}
    }
  }
  .environment(RiderSettingsStore.sample)
  .frame(width: 800, height: 760)
}
