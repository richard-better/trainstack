import RideData
import SwiftUI

/// Time left in the interval, time ridden and left in the workout, speed and distance. One row
/// when it fits, otherwise two.
struct PlayerSecondaryStats: View {
  let session: RideSession
  @Environment(\.dynamicTypeSize) private var dynamicTypeSize

  var body: some View {
    let intervalLeft = SmallStat(
      label: "Interval left", value: session.intervalRemaining?.clockString ?? "—")
    // The workout's length is in the title; what is left of it is what the rider counts down.
    let elapsed = SmallStat(
      label: "Elapsed", value: session.elapsed.clockString,
      unit: session.isComplete
        ? "/ \(session.duration.clockString)" : "· \(session.remaining.clockString) left")
    let speed = SmallStat(
      label: "Speed",
      value: session.latest.speed.map { ($0 * 3.6).formatted(.oneDecimal) } ?? "—",
      unit: "km/h")
    let distance = SmallStat(
      label: "Distance", value: (session.distance / 1000).formatted(.oneDecimal), unit: "km")
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
