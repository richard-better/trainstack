import RideBluetooth
import RideData
import SwiftUI

public struct RootView: View {
  @State private var destination = RideLibrary.launchDestination()
  @State private var discovery = BluetoothDiscovery()
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
  @Environment(\.scenePhase) private var scenePhase
  @Namespace private var player
  #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
  #endif

  public init() {}

  public var body: some View {
    Group {
      if destination == .settings && hasSidebar {
        // Settings takes over the sidebar, like drilling into System Settings.
        SettingsSplitView(page: $settingsPage, discovery: discovery, back: backToApp)
      } else {
        AppTabs(
          destination: $destination, today: $today, workouts: $workouts,
          historySelection: $historySelection, settingsPath: $settingsPath, library: library,
          discovery: discovery, player: player)
      }
    }
    .modifier(PlayerPresentation(launcher: launcher, namespace: player))
    .environment(settings)
    .environment(launcher)
    .onChange(of: destination) { _, destination in
      if destination != .settings { appDestination = destination }
    }
    // Scan only while the Devices page is on screen.
    .onChange(of: isShowingDevices && scenePhase == .active, initial: true) { _, isVisible in
      if isVisible {
        discovery.startScanning()
      } else {
        discovery.stopScanning()
      }
    }
    #if DEBUG
      .task { launcher.startLaunchRide(ftp: settings.ftp) }
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

  /// Whether the player covers everything else.
  private var isPlayerShowing: Bool {
    #if os(iOS)
      launcher.isPlayerPresented
    #else
      launcher.ride != nil
    #endif
  }

  private var isShowingDevices: Bool {
    guard destination == .settings, !isPlayerShowing else { return false }
    return hasSidebar ? settingsPage == .devices : settingsPath.last == .devices
  }

  private func backToApp() { destination = appDestination }
}

#Preview {
  RootView()
}
