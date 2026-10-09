import RideBluetooth
import RideData
import SwiftUI

/// What a workout asks of the rider: how long and how hard, then each interval in watts for
/// their FTP. Start ride stays pinned to the bottom beside the device status, so a ride can
/// start from anywhere on the page.
struct WorkoutDetailView: View {
  let template: WorkoutTemplate
  @Environment(RiderSettingsStore.self) private var settings
  @State private var isShowingDevices = false
  @Environment(RideLauncher.self) private var launcher

  var body: some View {
    let ftp = settings.ftp
    List {
      Section {
        WorkoutDetailChart(template: template, ftp: ftp)
          .padding(.vertical, 6)
      } header: {
        ZoneLabel(zone: template.category)
      }
      Section {
        WorkoutStats(template: template, ftp: ftp)
          .padding(.vertical, 2)
      }
      Section {
        VStack(alignment: .leading, spacing: 14) {
          if !template.about.isEmpty {
            Text(template.about)
              .font(.subheadline)
              .foregroundStyle(.secondary)
          }
          WorkoutZoneMix(template: template)
        }
        .listRowBackground(Color.clear)
        .listRowInsets(.horizontal, 4)
      }
      Section {
        WorkoutIntervals(template: template, ftp: ftp)
      } header: {
        Text(ftp.map { "Intervals · at your FTP of \($0) W" } ?? "Intervals")
      } footer: {
        if ftp == nil {
          Text("Add your FTP in Settings to see each interval in watts and ride the workout.")
        }
      }
    }
    #if os(iOS)
      .listStyle(.insetGrouped)
      .listSectionSpacing(.compact)
      .toolbarVisibility(.hidden, for: .tabBar)
      .navigationBarTitleDisplayMode(.large)
    #endif
    #if os(macOS)
      .frame(maxWidth: Design.ridePageWidth)
      .frame(maxWidth: .infinity)
    #endif
    .navigationTitle(template.name)
    .safeAreaBar(edge: .bottom) {
      #if os(macOS)
        // A ride in progress has its own bar there, and nothing else can start meanwhile.
        if launcher.ride == nil { startBar }
      #else
        startBar
      #endif
    }
    .sheet(isPresented: $isShowingDevices) { DevicesSheet() }
  }

  /// The device status in a capsule, then Start ride across the rest of the width.
  private var startBar: some View {
    GlassEffectContainer {
      HStack(spacing: 10) {
        DeviceStatusButton(action: showDevices)
          .buttonStyle(.plain)
          .font(.title3)
          .padding(.horizontal, 18)
          .frame(minHeight: 54)
          .glassEffect(.regular.interactive(), in: .capsule)
        StartButton(template: template, title: "Start ride", fillsWidth: true)
          .buttonStyle(.glassProminent)
          .controlSize(.extraLarge)
          .font(.headline)
      }
    }
    #if os(macOS)
      .frame(maxWidth: 560)
    #endif
    .padding(.horizontal, 16)
    .padding(.bottom, 8)
  }

  private func showDevices() { isShowingDevices = true }
}

#Preview {
  NavigationStack {
    WorkoutDetailView(template: .named("Threshold classic 60")!)
  }
  .environment(RideLauncher(simulated: true))
  .environment(RiderSettingsStore.sample)
  .environment(BluetoothDevices.sample(pairStrap: true))
}
