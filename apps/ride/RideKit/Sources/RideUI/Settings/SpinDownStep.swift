import RideBluetooth
import SwiftUI

struct SpinDownStep: View {
  let spinDown: SpinDown?
  let trainerName: String
  let offersSpinDown: Bool?

  var body: some View {
    Label {
      VStack(alignment: .leading, spacing: 4) {
        Text(title).font(.headline)
        Text(detail).foregroundStyle(.secondary)
      }
    } icon: {
      Image(systemName: symbol).foregroundStyle(tint)
    }
    .accessibilityElement(children: .combine)
  }

  private var title: String {
    switch spinDown {
    case nil:
      offersSpinDown == false ? "Not available on this trainer" : "Ready"
    case .starting: "Asking \(trainerName)…"
    case .speedUp: "Pedal faster"
    case .stopPedalling: "Stop pedalling"
    case .succeeded: "Calibrated"
    case .failed: "Calibration didn't finish"
    case .unsupported: "Not available on this trainer"
    }
  }

  private var detail: String {
    switch spinDown {
    case nil:
      offersSpinDown == false
        ? "\(trainerName) does not offer a spin-down over Bluetooth. Calibrate it in its maker's app."
        : "Start, then pedal up to the speed shown, stop pedalling and let the flywheel coast to a stop."
    case .starting: "Keep the bike still for a moment."
    case .speedUp(let target?):
      "Pedal up past \(Int(target.upperBound.rounded())) km/h, then wait to be told to stop."
    case .speedUp(nil): "Pedal up to a fast spin, then wait to be told to stop."
    case .stopPedalling: "Stop pedalling and keep still while the flywheel coasts to a stop."
    case .succeeded: "\(trainerName) finished its spin-down and keeps the result itself."
    case .failed:
      "The trainer did not finish its spin-down. Make sure nothing touches the flywheel, then try again."
    case .unsupported:
      "\(trainerName) does not offer a spin-down over Bluetooth. Calibrate it in its maker's app."
    }
  }

  private var symbol: String {
    switch spinDown {
    case .succeeded: "checkmark.circle.fill"
    case .failed: "exclamationmark.triangle.fill"
    case .unsupported: "nosign"
    case .stopPedalling: "hand.raised.fill"
    case .speedUp: "speedometer"
    case .starting: "ellipsis.circle"
    case nil: offersSpinDown == false ? "nosign" : "arrow.trianglehead.2.clockwise"
    }
  }

  private var tint: Color {
    switch spinDown {
    case .succeeded: .green
    case .failed: .orange
    case .unsupported: .secondary
    case .stopPedalling: .red
    default: .accentColor
    }
  }
}
