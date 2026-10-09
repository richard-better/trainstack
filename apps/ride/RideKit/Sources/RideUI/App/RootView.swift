import RideBluetooth
import RideData
import SwiftUI

public struct RootView: View {
  @State private var destination = RideLibrary.launchDestination()
  @State private var library = RideLibrary.launchLibrary()
  @State private var settings = RiderSettingsStore.launchStore()
  @State private var launcher = RideLauncher.launchLauncher()
  /// Where Back to app returns to from Settings.
  @State private var appDestination = AppDestination.today
  @State private var settingsPage = SettingsPage.zones(.all)
  @State private var settingsPath: [SettingsPage] = []
  // The tabs are rebuilt when Settings takes over the sidebar, so what the rider chose in them
  // is held here.
  @State private var today = TodayState()
  @State private var workouts = WorkoutsState()
  @State private var historySelection: Ride.ID?
  @Namespace private var player
  #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
  #endif

  public init() {}

  public var body: some View {
    Group {
      if destination == .settings && hasSidebar {
        // Settings takes over the sidebar, like drilling into System Settings.
        SettingsSplitView(page: $settingsPage, back: backToApp)
      } else {
        AppTabs(
          destination: $destination, today: $today, workouts: $workouts,
          historySelection: $historySelection, settingsPath: $settingsPath, library: library,
          player: player)
      }
    }
    .modifier(PlayerPresentation(launcher: launcher, library: library, namespace: player))
    .environment(settings)
    .environment(launcher)
    .environment(launcher.devices)
    .task { launcher.devices.connectPaired() }
    .alert("Couldn't Save the Ride", isPresented: storageProblemShown) {
      Button("OK") {}
    } message: {
      Text(library.storageProblem ?? "")
    }
    .onChange(of: destination) { _, destination in
      if destination != .settings { appDestination = destination }
    }
    #if DEBUG
      .task {
        launcher.startLaunchRide(ftp: settings.ftp, heartRateZones: settings.heartRateZones)
      }
    #endif
  }

  /// Whether the app has a sidebar for Settings to take over, rather than a tab bar.
  private var hasSidebar: Bool {
    #if os(iOS)
      sizeClass == .regular
    #else
      true
    #endif
  }

  private func backToApp() { destination = appDestination }

  private var storageProblemShown: Binding<Bool> {
    Binding(
      get: { library.storageProblem != nil },
      set: { if !$0 { library.storageProblem = nil } })
  }
}

#Preview {
  RootView()
}
