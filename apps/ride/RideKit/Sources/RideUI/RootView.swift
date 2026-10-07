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
  @State private var appDestination = Destination.today
  @State private var settingsPage = SettingsPage.zones(.all)
  @State private var settingsPath: [SettingsPage] = []
  @Environment(\.scenePhase) private var scenePhase
  @Namespace private var player
  #if os(iOS)
    @Environment(\.horizontalSizeClass) private var sizeClass
  #endif

  public init() {}

  public var body: some View {
    Group {
      #if os(iOS)
        // The player covers the app, and minimises to an accessory above the tab bar.
        app
          .fullScreenCover(isPresented: $launcher.isPlayerPresented) {
            if let ride = launcher.ride {
              NavigationStack {
                PlayerView(controller: ride, onEnd: launcher.end)
              }
              .navigationTransition(.zoom(sourceID: "player", in: player))
            }
          }
      #else
        // The ride in progress takes over the window until it ends.
        if let ride = launcher.ride {
          NavigationStack {
            PlayerView(controller: ride, onEnd: launcher.end)
          }
        } else {
          app
        }
      #endif
    }
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

  /// The tabs, or Settings when it has taken over the sidebar.
  @ViewBuilder private var app: some View {
    if destination == .settings && hasSidebar {
      // Settings takes over the sidebar, like drilling into System Settings.
      SettingsSplitView(page: $settingsPage, discovery: discovery) {
        destination = appDestination
      }
    } else {
      #if os(iOS)
        tabs
          .tabViewBottomAccessory(isEnabled: launcher.ride != nil) {
            if let ride = launcher.ride {
              RideAccessory(controller: ride) { launcher.isPlayerPresented = true }
                .matchedTransitionSource(id: "player", in: player)
            }
          }
      #else
        tabs
      #endif
    }
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

  private var tabs: some View {
    // Sidebar on macOS and iPad, tab bar on iPhone.
    TabView(selection: $destination) {
      Tab("Today", systemImage: "calendar", value: .today) {
        NavigationStack {
          TodayView { destination = .settings }
        }
      }
      Tab("Workouts", systemImage: "chart.bar", value: .workouts) {
        NavigationStack {
          WorkoutsView()
        }
      }
      Tab("History", systemImage: "clock", value: .history) {
        HistoryView(library: library)
      }
      Tab("Progress", systemImage: "chart.line.uptrend.xyaxis", value: .progress) {
        NavigationStack {
          TrainingProgressView(library: library) { destination = .settings }
        }
      }
      Tab("Settings", systemImage: "gearshape", value: .settings) {
        SettingsList(discovery: discovery, path: $settingsPath)
      }
    }
    .tabViewStyle(.sidebarAdaptable)
  }
}

private enum Destination: Hashable {
  case today, workouts, history, progress, settings
}

#Preview {
  RootView()
}

extension RiderSettingsStore {
  /// The saved profile, except that debug builds started with `-sample-rides` use the sample one.
  fileprivate static func launchStore() -> RiderSettingsStore {
    #if DEBUG
      if CommandLine.arguments.contains("-sample-rides") { return .sample }
    #endif
    return RiderSettingsStore()
  }
}

extension RideLauncher {
  /// Debug builds started with `-sample-rides` or `-simulated-trainer` ride with a pretend
  /// trainer, so the player can be tried without hardware.
  fileprivate static func launchLauncher() -> RideLauncher {
    #if DEBUG
      let arguments = CommandLine.arguments
      if arguments.contains("-sample-rides") || arguments.contains("-simulated-trainer") {
        return RideLauncher(simulated: true)
      }
    #endif
    return RideLauncher()
  }

  #if DEBUG
    /// Debug builds started with `-ride "<workout name>"` open straight into that ride.
    fileprivate func startLaunchRide(ftp: Int?) {
      let arguments = CommandLine.arguments
      guard let flag = arguments.firstIndex(of: "-ride"), flag + 1 < arguments.count,
        let template = WorkoutTemplate.named(arguments[flag + 1]), let ftp
      else { return }
      start(template, ftp: ftp)
    }
  #endif
}

extension RideLibrary {
  /// Empty, except that debug builds started with `-sample-rides` begin with the sample ride.
  fileprivate static func launchLibrary() -> RideLibrary {
    #if DEBUG
      if CommandLine.arguments.contains("-sample-rides") { return .sample() }
    #endif
    return RideLibrary()
  }

  /// Debug builds started with `-sample-rides` open on History, where the sample ride is.
  fileprivate static func launchDestination() -> Destination {
    #if DEBUG
      if CommandLine.arguments.contains("-sample-rides") { return .history }
    #endif
    return .today
  }
}
