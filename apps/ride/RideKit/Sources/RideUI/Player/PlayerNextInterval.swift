import RideData
import RideLink
import SwiftUI

struct PlayerNextInterval: View {
  let controller: RideController
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    let session = controller.session
    if session.currentInterval != nil {
      let remaining = session.intervalRemaining
      let isNear = !session.isPaused && remaining.map { $0 <= IntervalCountdown.warning } == true
      let label = Text(
        session.awaitsLap
          ? "Next, when you press lap"
          : isNear ? "Next in \((remaining ?? 0).clockString)" : "Next"
      )
      .font(.caption)
      .foregroundStyle(isNear ? .primary : .secondary)
      ViewThatFits(in: .horizontal) {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
          label
          details(isNear: isNear)
        }
        VStack(alignment: .leading, spacing: 4) {
          label
          HStack(alignment: .firstTextBaseline, spacing: 10) { details(isNear: isNear) }
        }
      }
      .lineLimit(1)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.vertical, 10)
      .accessibilityElement(children: .combine)
      .animation(reduceMotion ? nil : .default, value: isNear)
    } else if let free = session.freeRideElapsed {
      HStack(alignment: .firstTextBaseline, spacing: 10) {
        Label("Workout complete", systemImage: "flag.checkered")
          .font(Design.statValueFont)
        Text(
          "Free ride \(free.clockString) · \(session.mode.rawValue) · end the ride when you are done"
        )
        .font(.subheadline)
        .foregroundStyle(.secondary)
      }
      .lineLimit(2)
      .frame(maxWidth: .infinity, alignment: .leading)
      .padding(.vertical, 10)
      .accessibilityElement(children: .combine)
    }
  }

  @ViewBuilder private func details(isNear: Bool) -> some View {
    let session = controller.session
    if let next = session.nextInterval {
      IntervalBadge(interval: next, ftp: controller.ftp, isHighlighted: isNear)
      if session.mode == .erg, let watts = next.plannedPower(at: next.start) {
        target(value: "\(session.adjusted(watts))", unit: "W")
      } else if case .heartRate(let heartRate) = next.step.target {
        let text = StepTargetText.heartRate(heartRate)
        target(value: text.value, unit: text.unit)
      }
      Text(
        next.step.endsOnLap ? "until you press lap" : "for \((next.end - next.start).clockString)"
      )
      .font(.subheadline)
      .foregroundStyle(.secondary)
    } else {
      Label("Finish", systemImage: "flag.checkered")
        .font(Design.statValueFont)
      Text("Last interval").font(.subheadline).foregroundStyle(.secondary)
    }
  }

  private func target(value: String, unit: String) -> some View {
    HStack(alignment: .firstTextBaseline, spacing: 4) {
      Text(value).font(Design.statValueFont)
      Text(unit).font(.subheadline).foregroundStyle(.secondary)
    }
  }
}
