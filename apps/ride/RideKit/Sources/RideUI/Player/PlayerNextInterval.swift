import RideData
import RideLink
import SwiftUI

struct PlayerNextInterval: View {
  let controller: RideController
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  var body: some View {
    let session = controller.session
    if let remaining = session.intervalRemaining {
      let isNear = !session.isPaused && remaining <= IntervalCountdown.warning
      let label = Text(isNear ? "Next in \(remaining.clockString)" : "Next")
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
      Text("for \((next.end - next.start).clockString)")
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
