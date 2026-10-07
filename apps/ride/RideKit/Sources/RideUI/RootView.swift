import RideBluetooth
import SwiftUI

public struct RootView: View {
  @State private var destination = RideLibrary.launchDestination()
  @State private var discovery = BluetoothDiscovery()
  @State private var library = RideLibrary.launchLibrary()
  @State private var profile = RiderProfileStore.launchStore()
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
    .environment(profile)
    .environment(launcher)
  }

  private var tabs: some View {
    // Sidebar on macOS and iPad, tab bar on iPhone.
    TabView(selection: $destination) {
      Tab("Today", systemImage: "calendar", value: .today) {
        NavigationStack {
          TodayView { destination = .devices }
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
  case today, workouts, history, devices, settings
}

private struct TodayView: View {
  let findDevices: () -> Void

  var body: some View {
    ContentUnavailableView {
      Label("TrainStack Ride", systemImage: "bicycle")
    } description: {
      Text("Find your trainer and sensors to get started.")
    } actions: {
      Button("Find devices", action: findDevices)
        .buttonStyle(.borderedProminent)
    }
    .navigationTitle("Today")
  }
}

#Preview {
  RootView()
}

extension RiderProfileStore {
  /// The saved profile, except that debug builds started with `-sample-rides` use the sample one.
  fileprivate static func launchStore() -> RiderProfileStore {
    #if DEBUG
      if CommandLine.arguments.contains("-sample-rides") { return .sample }
    #endif
    return RiderProfileStore()
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
