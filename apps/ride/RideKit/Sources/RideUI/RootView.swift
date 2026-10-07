import RideBluetooth
import RideData
import SwiftUI

public struct RootView: View {
  @State private var destination = RideLibrary.launchDestination()
  @State private var discovery = BluetoothDiscovery()
  @State private var library = RideLibrary.launchLibrary()
  @State private var settings = RiderSettingsStore.launchStore()
  @State private var launcher = RideLauncher.launchLauncher()
  @Environment(\.scenePhase) private var scenePhase

  public init() {}

  public var body: some View {
    Group {
      // The ride in progress takes over the window until it ends.
      if let ride = launcher.ride {
        NavigationStack {
          PlayerView(controller: ride, onEnd: launcher.end)
        }
      } else {
        tabs
      }
    }
    .environment(settings)
    .environment(launcher)
    #if DEBUG
      .task { launcher.startLaunchRide(ftp: settings.ftp) }
    #endif
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
      Tab("Devices", systemImage: "antenna.radiowaves.left.and.right", value: .devices) {
        NavigationStack {
          DevicesView(discovery: discovery)
        }
      }
      Tab("Settings", systemImage: "gearshape", value: .settings) {
        NavigationStack {
          SettingsView()
        }
      }
    }
    .tabViewStyle(.sidebarAdaptable)
    // Driven by selection rather than onAppear, which TabView does not pair reliably.
    .onChange(of: destination == .devices && scenePhase == .active, initial: true) {
      _, isVisible in
      if isVisible {
        discovery.startScanning()
      } else {
        discovery.stopScanning()
      }
    }
  }
}

private enum Destination: Hashable {
  case today, workouts, history, progress, devices, settings
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
