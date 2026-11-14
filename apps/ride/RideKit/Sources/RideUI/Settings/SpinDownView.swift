import RideBluetooth
import SwiftUI

struct SpinDownView: View {
  @Environment(BluetoothDevices.self) private var devices
  @Environment(RideLauncher.self) private var launcher

  var body: some View {
    Form {
      if let trainer = devices.paired(.trainer) {
        Section {
          LabeledContent("Trainer", value: trainer.displayName)
          if let speed = devices.trainerKilometresPerHour, devices.spinDown?.isUnderway == true {
            LabeledContent("Speed") {
              Text("\(speed.formatted(.number.precision(.fractionLength(1)))) km/h")
                .font(.title.weight(.semibold)).monospacedDigit()
            }
          }
        } footer: {
          Text(
            "A spin-down measures how much your trainer's flywheel slows by itself, so it can work out your power more accurately. Do it after ten minutes of riding, once the trainer is warm."
          )
        }
        Section {
          SpinDownStep(
            spinDown: devices.spinDown, trainerName: trainer.displayName,
            offersSpinDown: devices.trainerOffersSpinDown)
          action(isConnected: devices.connectionState(of: trainer.id) == .connected)
        }
      } else {
        ContentUnavailableView(
          "No Trainer", systemImage: "bicycle",
          description: Text("Pair a smart trainer in Devices to calibrate it."))
      }
    }
    .formStyle(.grouped)
    .navigationTitle("Calibrate Trainer")
    .onDisappear { devices.endSpinDown() }
  }

  @ViewBuilder
  private func action(isConnected: Bool) -> some View {
    if devices.spinDown?.isUnderway == true {
      Button("Stop Calibrating", role: .cancel) { devices.endSpinDown() }
    } else if devices.spinDown != .unsupported, devices.trainerOffersSpinDown != false {
      Button(devices.spinDown == nil ? "Start Spin-Down" : "Spin Down Again") {
        devices.startSpinDown()
      }
      .disabled(!isConnected || launcher.ride != nil)
    }
  }
}
