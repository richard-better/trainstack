import RideData
import SwiftUI

/// Starts the selected workout. Return starts it too. Targets are set from FTP, so without one
/// there is nothing to start. The caller styles it.
struct StartButton: View {
  let template: WorkoutTemplate?
  var title: String = "Start"
  /// Whether the label stretches across the width it is offered, as at the foot of a page.
  var fillsWidth = false
  @Environment(RideLauncher.self) private var launcher
  @Environment(RiderSettingsStore.self) private var settings

  var body: some View {
    Group {
      if fillsWidth {
        Button(action: start) {
          Label(title, systemImage: "play.fill")
            .labelStyle(.titleAndIcon)
            .frame(maxWidth: .infinity)
        }
      } else {
        Button(title, systemImage: "play.fill", action: start)
      }
    }
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
