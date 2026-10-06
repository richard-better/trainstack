import RideBluetooth
import SwiftUI

public struct RootView: View {
  @State private var destination = Destination.today
  @State private var discovery = BluetoothDiscovery()
  @Environment(\.scenePhase) private var scenePhase

  public init() {}

  public var body: some View {
    // Sidebar on macOS and iPad, tab bar on iPhone.
    TabView(selection: $destination) {
      Tab("Today", systemImage: "calendar", value: .today) {
        NavigationStack {
          TodayView { destination = .devices }
        }
      }
      Tab("Devices", systemImage: "antenna.radiowaves.left.and.right", value: .devices) {
        NavigationStack {
          DevicesView(discovery: discovery)
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
  case today, devices
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
