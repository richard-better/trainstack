import RideBluetooth
import RideData
import RideStrava
import SwiftUI

struct WorkoutDetailView: View {
  let template: WorkoutTemplate
  @Environment(RiderSettingsStore.self) private var settings
  @State private var isShowingDevices = false
  @Environment(RideLauncher.self) private var launcher
  @Environment(AccountWorkouts.self) private var accountWorkouts
  @State private var savedCopy: (account: String, id: LibraryWorkout.ID)?

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
    .toolbar {
      if accountWorkouts.account != nil {
        ToolbarItem(placement: .secondaryAction) {
          Button(
            isSaved ? "Saved to My Workouts" : "Save to My Workouts",
            systemImage: isSaved ? "checkmark" : "square.and.arrow.down",
            action: saveCopy
          )
          .disabled(isSaved)
          .help("Save a copy to your TrainStack library, where you can change it on the web")
        }
      }
    }
    .safeAreaBar(edge: .bottom) {
      #if os(macOS)
        if launcher.ride == nil { startBar }
      #else
        startBar
      #endif
    }
    .sheet(isPresented: $isShowingDevices) { DevicesSheet() }
  }

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

  private var isSaved: Bool {
    guard let savedCopy, savedCopy.account == accountWorkouts.account else { return false }
    return accountWorkouts[savedCopy.id] != nil
  }

  private func saveCopy() {
    guard let account = accountWorkouts.account,
      let id = accountWorkouts.saveCopy(of: template)
    else { return }
    savedCopy = (account, id)
  }
}

#Preview {
  NavigationStack {
    WorkoutDetailView(template: .named("Threshold classic 60")!)
  }
  .environment(RideLauncher(simulated: true))
  .environment(RiderSettingsStore.sample)
  .environment(AccountWorkouts())
  .environment(BluetoothDevices.sample(pairStrap: true))
}
