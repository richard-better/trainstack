import RideData
import SwiftUI

/// Time ridden this week, and its training stress when the rider has an FTP.
struct ThisWeekStat: View {
  let rides: [RideRecording]
  @Environment(RiderSettingsStore.self) private var settings
  @Environment(\.calendar) private var calendar

  var body: some View {
    let week = calendar.dateInterval(of: .weekOfYear, for: .now)
    let ridden = rides.filter { week?.contains($0.startDate) ?? false }
    let time = ridden.reduce(0) { $0 + $1.summary.duration }
    let stress = settings.ftp.map { _ in
      ridden.compactMap { ride in settings.ftp(for: ride).flatMap(ride.trainingStressScore) }
        .reduce(0, +)
    }
    HeadlineStat(label: "This week") {
      Text(Duration.seconds(time).formatted(.time(pattern: .hourMinute)))
      Text(stress.map { "h · \($0) TSS" } ?? "h").font(.subheadline).foregroundStyle(.secondary)
    }
  }
}
