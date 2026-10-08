import RideData
import SwiftUI

/// Starts the selected workout. Return starts it too. Targets are set from FTP, so without one
/// there is nothing to start.
struct StartButton: View {
  let template: WorkoutTemplate?
  var title: String = "Start"
  @Environment(RideLauncher.self) private var launcher
  @Environment(RiderSettingsStore.self) private var settings

  var body: some View {
    Button(title, systemImage: "play.fill", action: start)
      .buttonStyle(.borderedProminent)
      .keyboardShortcut(.defaultAction)
      .disabled(template == nil || settings.ftp == nil || launcher.ride != nil)
      .help(help)
  }

  private func start() {
    if let template, let ftp = settings.ftp {
      launcher.start(template, ftp: ftp, heartRateZones: settings.heartRateZones)
    }
  }

  private var help: String {
    if settings.ftp == nil { return "Add your FTP in Settings to ride a workout." }
    return launcher.ride == nil ? "" : "End the ride in progress to start another."
  }
}
