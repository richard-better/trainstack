import RideData
import SwiftUI

struct RampTestView: View {
  @Environment(RideLauncher.self) private var launcher
  @Environment(RiderSettingsStore.self) private var settings

  var body: some View {
    let test = RampTest(ftp: settings.ftp)
    Form {
      Section {
        LabeledContent("Warm-up", value: "5 min")
        LabeledContent(
          "Steps", value: "+\(test.stepWatts) W a minute from \(test.firstStepWatts) W")
        LabeledContent("Ends", value: "When you can't hold the step")
        LabeledContent("Cool-down", value: "5 min")
      } footer: {
        Text(
          settings.ftp.map {
            "The steps are sized from your FTP of \($0) W, so the ramp takes about ten to fifteen minutes."
          }
            ?? "The steps are sized for an FTP of \(RampTest.assumedFTP) W, as you have not set one."
        )
      }
      Section {
        Button("Start Ramp Test", systemImage: "play.fill", action: start)
          .disabled(launcher.ride != nil)
      } footer: {
        Text(
          "Ride in ERG mode at a steady cadence and hold each step as long as you can. The ramp ends by itself once your power stays under 80% of the step for ten seconds, then you cool down. Your FTP estimate is 75% of your best minute, and you decide whether to keep it."
        )
      }
    }
    .formStyle(.grouped)
    .navigationTitle("Ramp Test")
  }

  private func start() {
    let test = RampTest(ftp: settings.ftp)
    launcher.start(
      test.planned, ftp: test.ftp, heartRateZones: settings.heartRateZones,
      riderWeight: settings.weight)
  }
}

#Preview {
  NavigationStack {
    RampTestView()
  }
  .environment(RiderSettingsStore.sample)
  .environment(RideLauncher(simulated: true))
}
