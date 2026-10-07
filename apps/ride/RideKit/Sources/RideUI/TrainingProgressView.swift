import RideData
import SwiftUI

/// How training is going: fitness, fatigue and form as numbers first, then the trend, then
/// where the time went.
struct TrainingProgressView: View {
  let library: RideLibrary
  let openSettings: () -> Void
  @Environment(RiderSettingsStore.self) private var settings
  @Environment(\.calendar) private var calendar

  var body: some View {
    let rides = library.rides.map(\.recording)
    Group {
      if rides.isEmpty {
        ContentUnavailableView(
          "No rides yet", systemImage: "chart.line.uptrend.xyaxis",
          description: Text("Fitness, fatigue and form build up here as you ride."))
      } else {
        ScrollView {
          VStack(alignment: .leading, spacing: 22) {
            if settings.ftp != nil {
              let load = dailyLoad(of: rides)
              LoadHeadline(load: load, rides: rides)
              TrendSection(load: load)
            } else {
              NoFTPHeadline(rides: rides, openSettings: openSettings)
            }
            BreakdownSections(rides: rides)
          }
          .monospacedDigit()
          .padding(.horizontal, 32)
          .padding(.vertical, 24)
          .frame(maxWidth: 1100, alignment: .leading)
          .frame(maxWidth: .infinity, alignment: .leading)
        }
      }
    }
    .navigationTitle("Progress")
  }

  /// Daily load for the longest span, starting early enough that fitness has built up by the
  /// first day shown. Each ride is scored against the FTP in effect on its day.
  private func dailyLoad(of rides: [RideRecording]) -> [TrainingLoad] {
    let today = Date.now
    let lead = Int(TrainingLoad.fitnessDays) * 3
    guard
      let start = calendar.date(
        byAdding: .day, value: -(ProgressSpan.oneYear.days + lead), to: today)
    else { return [] }
    return TrainingLoad.daily(
      stress: rides.stressByDay(calendar: calendar) { settings.ftp(for: $0) }, from: start,
      through: today, calendar: calendar)
  }
}

#Preview {
  NavigationStack {
    TrainingProgressView(library: .sample()) {}
  }
  .environment(RiderSettingsStore.sample)
  .frame(width: 900, height: 800)
}
