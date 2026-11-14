import RideData
import SwiftUI

struct AppTabs: View {
  @Binding var destination: AppDestination
  @Binding var today: TodayState
  @Binding var workouts: WorkoutsState
  @Binding var historySelection: Ride.ID?
  @Binding var settingsPath: [SettingsPage]
  let library: RideLibrary
  let player: Namespace.ID
  @Environment(RideLauncher.self) private var launcher
  @State private var todayPath = NavigationPath()
  @State private var workoutsPath = NavigationPath()

  var body: some View {
    TabView(selection: $destination) {
      Tab("Today", systemImage: "calendar", value: .today) {
        NavigationStack(path: $todayPath) {
          TodayView(state: $today, openSettings: openSettings)
            .navigationDestination(for: WorkoutTemplate.self, destination: WorkoutDetailView.init)
            .navigationDestination(for: PlannedItemRoute.self) { PlannedItemDetailView(id: $0.id) }
        }
        .environment(
          \.openWorkout,
          OpenWorkoutAction({ todayPath.append($0) }, planned: { todayPath.append($0) }))
      }
      Tab("Workouts", systemImage: "chart.bar", value: .workouts) {
        NavigationStack(path: $workoutsPath) {
          WorkoutsView(state: $workouts)
            .navigationDestination(for: WorkoutTemplate.self, destination: WorkoutDetailView.init)
            .navigationDestination(for: LibraryWorkoutRoute.self) {
              LibraryWorkoutDetailView(id: $0.id)
            }
        }
        .environment(
          \.openWorkout,
          OpenWorkoutAction({ workoutsPath.append($0) }, library: { workoutsPath.append($0) }))
      }
      Tab("History", systemImage: "clock", value: .history) {
        HistoryView(library: library, selection: $historySelection)
      }
      Tab("Progress", systemImage: "chart.line.uptrend.xyaxis", value: .progress) {
        NavigationStack {
          TrainingProgressView(library: library, openSettings: openSettings)
        }
      }
      Tab("Settings", systemImage: "gearshape", value: .settings) {
        SettingsList(path: $settingsPath)
      }
    }
    .tabViewStyle(.sidebarAdaptable)
    #if os(iOS)
      .tabBarMinimizeBehavior(.onScrollDown)
      .tabViewBottomAccessory(isEnabled: launcher.ride != nil) {
        if let ride = launcher.ride {
          RideAccessory(controller: ride, open: showPlayer)
          .matchedTransitionSource(id: "player", in: player)
        }
      }
    #endif
  }

  private func openSettings() { destination = .settings }

  private func showPlayer() { launcher.isPlayerPresented = true }
}
