import RideData
import RideStrava
import SwiftUI

struct AccountActivitySummaryView: View {
  let activity: AccountActivity
  var file = AccountActivityDetailView.FileState.notNeeded
  var retry: () -> Void = {}
  @Environment(AccountHistory.self) private var history

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 22) {
        VStack(alignment: .leading, spacing: 4) {
          if let date = activity.date {
            Text(
              "\(date, format: .dateTime.weekday(.wide).day().month(.wide).year()) · \(date, format: .dateTime.hour().minute())"
            )
            .foregroundStyle(.secondary)
          }
          Text(activity.title).font(.largeTitle).bold()
          Label(activity.sportName, systemImage: activity.symbol)
            .font(.subheadline)
            .foregroundStyle(.secondary)
        }
        if activity.stats.isEmpty {
          Text("Trainstack has not summarised this activity yet.")
            .foregroundStyle(.secondary)
        } else {
          RideStatsRow(stats: activity.stats)
        }
        fileNote
        if !activity.hasFIT, laps.count > 1 {
          VStack(alignment: .leading, spacing: 14) {
            Text("Laps").font(.headline)
            LapTable(laps: laps)
          }
        }
        RouteSection(activity: activity)
      }
      .pageLayout(maxWidth: Design.ridePageWidth, alignment: .center)
    }
    .task(id: activity) {
      await history.loadDetailIfNeeded(
        of: activity, forLaps: !activity.hasFIT && activity.logged == nil)
    }
  }

  @ViewBuilder private var fileNote: some View {
    switch file {
    case .downloading:
      HStack(spacing: 8) {
        ProgressView().controlSize(.small)
        Text("Downloading the activity's file for its charts, laps and zones…")
      }
      .foregroundStyle(.secondary)
    case .needsConnection:
      VStack(alignment: .leading, spacing: 8) {
        Label(
          "Charts, laps and zones need a connection to download this activity's file.",
          systemImage: "wifi.slash"
        )
        .foregroundStyle(.secondary)
        Button("Try Again", action: retry).buttonStyle(.bordered)
      }
    case .unreadable:
      Label(
        "Ride could not read this activity's FIT file.", systemImage: "exclamationmark.triangle"
      )
      .foregroundStyle(.secondary)
    case .notNeeded:
      if let note { Text(note).foregroundStyle(.secondary) }
    }
  }

  private var note: String? {
    if let logged = activity.logged {
      return logged.sport == "bouldering"
        ? "Logged by hand. Each problem and attempt is in your logbook on the web."
        : "Logged by hand. Each exercise and set is in your logbook on the web."
    }
    guard let file = activity.file else {
      return "No file is stored for this activity, so it has no charts or zones."
    }
    guard file.format != "fit" else { return nil }
    return
      "Charts and zones come from an activity's file, and Ride reads FIT files. This one is \(file.format.uppercased()), so its charts are on the web."
  }

  private var laps: [RideLap] {
    guard let detail = history.detail(of: activity.id), let start = activity.startedAt else {
      return []
    }
    return detail.laps.map { lap in
      let statistics = lap.statistics
      let length =
        statistics["timer_s"] ?? statistics["elapsed_s"]
        ?? lap.endedAt.map { $0.timeIntervalSince(lap.startedAt) } ?? 0
      return RideLap(
        start: lap.startedAt.timeIntervalSince(start), duration: length, trigger: .other,
        distanceMetres: statistics["distance_m"],
        averagePower: statistics["average_power_w"].map { Int($0.rounded()) },
        maxPower: statistics["max_power_w"].map { Int($0.rounded()) },
        averageHeartRate: statistics["average_heart_rate_bpm"].map { Int($0.rounded()) },
        maxHeartRate: statistics["max_heart_rate_bpm"].map { Int($0.rounded()) },
        averageCadence: statistics["average_cadence_rpm"].map { Int($0.rounded()) })
    }
  }
}
