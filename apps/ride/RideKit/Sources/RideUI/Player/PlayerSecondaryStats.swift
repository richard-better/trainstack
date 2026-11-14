import RideData
import SwiftUI

struct PlayerSecondaryStats: View {
  let session: RideSession
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    let intervalLeft =
      session.awaitsLap
      ? SmallStat(
        label: "Interval, until lap", value: session.intervalElapsed?.clockString ?? "—",
        unit: session.currentInterval?.step.untilLap?.hint)
      : SmallStat(
        label: "Interval left", value: session.intervalRemaining?.clockString ?? "—")
    let elapsed = SmallStat(
      label: "Elapsed", value: session.elapsed.clockString,
      unit: session.isComplete
        ? "/ \(session.duration.clockString)"
        : session.hasLapStepsAhead
          ? "· \(session.remaining.clockString) left + lap-button steps"
          : "· \(session.remaining.clockString) left")
    let speed = SmallStat(
      label: "Speed",
      value: (session.speedMetresPerSecond * 3.6).formatted(.oneDecimal),
      unit: "km/h")
    let distance = SmallStat(
      label: "Distance", value: (session.distanceMetres / 1000).formatted(.oneDecimal), unit: "km")
    Group {
      if dynamicTypeSize.isAccessibilitySize {
        VStack(alignment: .leading, spacing: 8) {
          intervalLeft
          elapsed
          speed
          distance
        }
      } else {
        ViewThatFits(in: .horizontal) {
          DividedRow {
            intervalLeft
            elapsed
            speed
            distance
          }
          Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
            GridRow {
              intervalLeft
              elapsed
            }
            GridRow {
              speed
              distance
            }
          }
        }
      }
    }
    .overlay(alignment: .top) { Divider() }
    .overlay(alignment: .bottom) { Divider() }
  }
}
