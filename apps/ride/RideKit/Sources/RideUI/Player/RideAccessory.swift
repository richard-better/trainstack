import RideData
import RideStyle
import SwiftUI

#if os(iOS)
  /// The ride in progress, shown above the tab bar while the player is minimised, like the
  /// track playing in Music. Tap it to go back to the player.
  struct RideAccessory: View {
    let controller: RideController
    let open: () -> Void
    @Environment(\.tabViewBottomAccessoryPlacement) private var placement
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var session: RideSession { controller.session }

    var body: some View {
      HStack(spacing: 12) {
        Button(action: open) {
          HStack(spacing: 10) {
            Capsule()
              .fill(zoneColor)
              .frame(width: 4, height: placement == .inline ? 16 : 28)
            VStack(alignment: .leading, spacing: 0) {
              Text(controller.template.name)
                .font(.subheadline)
                .bold()
              if placement != .inline {
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
      .padding(.horizontal, 16)
      .monospacedDigit()
    }

    private var power: some View {
      HStack(alignment: .firstTextBaseline, spacing: 2) {
        Text(session.latest.power.map(String.init) ?? "—")
          .font(.headline)
          .contentTransition(.numericText())
          .animation(reduceMotion ? nil : .default, value: session.latest.power)
        Text("W").font(.caption).foregroundStyle(.secondary)
      }
      .accessibilityElement(children: .ignore)
      .accessibilityLabel(session.latest.power.map { "\($0) watts" } ?? "No power")
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
#endif
