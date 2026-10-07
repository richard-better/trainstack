import RideBluetooth
import SwiftUI

/// The app's sections: a sidebar on macOS and iPad, a tab bar on iPhone. On iOS a ride in
/// progress shows above the tab bar while the player is minimised.
struct AppTabs: View {
  @Binding var destination: AppDestination
  @Binding var today: TodayState
  @Binding var workouts: WorkoutsState
  @Binding var historySelection: Ride.ID?
  @Binding var settingsPath: [SettingsPage]
  let library: RideLibrary
  let devices: BluetoothDevices
  /// Where the player zooms from and back to.
  let player: Namespace.ID
  @Environment(RideLauncher.self) private var launcher

  var body: some View {
    TabView(selection: $destination) {
      Tab("Today", systemImage: "calendar", value: .today) {
        NavigationStack {
          TodayView(state: $today, openSettings: openSettings)
        }
      }
      Tab("Workouts", systemImage: "chart.bar", value: .workouts) {
        NavigationStack {
          WorkoutsView(state: $workouts)
        }
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
        SettingsList(devices: devices, path: $settingsPath)
      }
    }
    .tabViewStyle(.sidebarAdaptable)
    #if os(iOS)
      // The tab bar shrinks while scrolling down, and the ride accessory goes inline with it.
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
