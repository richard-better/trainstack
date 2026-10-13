import RideData
import RideStyle
import SwiftUI

/// What the ride in progress shows while the player is minimised: its colour, name and status,
/// the power, and a pause button. Tap it to go back to the player.
struct RideAccessoryContent: View {
  let controller: RideController
  /// Whether it has room for one line only, as beside the tab bar on iPhone.
  var isInline = false
  let open: () -> Void
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  private var session: RideSession { controller.session }

  var body: some View {
    HStack(spacing: 12) {
      Button(action: open) {
        HStack(spacing: 10) {
          Capsule()
            .fill(zoneColor)
            .frame(width: 4, height: isInline ? 16 : 28)
          VStack(alignment: .leading, spacing: 0) {
            Text(controller.template.name)
              .font(.subheadline)
              .bold()
            if !isInline {
              Text(status).font(.caption).foregroundStyle(.secondary)
            }
          }
          .lineLimit(1)
          Spacer(minLength: 8)
          power
        }
        .contentShape(.rect)
      }
      .buttonStyle(.plain)
      .accessibilityHint("Shows the player")
      Button(
        session.isPaused ? "Resume" : "Pause",
        systemImage: session.isPaused ? "play.fill" : "pause.fill",
        action: controller.togglePause
      )
      .labelStyle(.iconOnly)
      .font(.title3)
      .buttonStyle(.plain)
      .contentTransition(.symbolEffect(.replace))
      .animation(reduceMotion ? nil : .default, value: session.isPaused)
    }
    .monospacedDigit()
  }

  private var power: some View {
    HStack(alignment: .firstTextBaseline, spacing: 2) {
      Text(controller.power.map(String.init) ?? "—")
        .font(.headline)
        .contentTransition(.numericText())
        .animation(reduceMotion ? nil : .default, value: controller.power)
      Text("W").font(.caption).foregroundStyle(.secondary)
    }
    .accessibilityElement(children: .ignore)
    .accessibilityLabel(controller.power.map { "\($0) watts" } ?? "No power")
  }

  private var zoneColor: Color {
    session.currentInterval.map { controller.zone(of: $0).color } ?? .secondary
  }

  private var status: String {
    guard let interval = session.currentInterval else { return "Workout complete" }
    if session.isPaused { return "Paused · \(session.elapsed.clockString)" }
    let zone = controller.zone(of: interval)
    let left = session.intervalRemaining.map { " · \($0.clockString) left" } ?? ""
    return "Z\(zone.rawValue + 1) \(zone.name)\(left)"
  }
}
