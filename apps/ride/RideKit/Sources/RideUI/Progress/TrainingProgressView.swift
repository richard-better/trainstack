import RideData
import SwiftUI

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
          .pageLayout()
        }
      }
    }
    .navigationTitle("Progress")
  }

  private func dailyLoad(of rides: [RideRecording]) -> [TrainingLoad] {
    let today = Date.now
    let fitnessWarmUpDays = Int(TrainingLoad.fitnessDays) * 3
    guard
      let start = calendar.date(
        byAdding: .day, value: -(ProgressSpan.oneYear.days + fitnessWarmUpDays), to: today)
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
