import RideData
import RideStyle
import SwiftUI

/// How the player chart fills an interval's target: in its power zone's colour, faint while it
/// is still to come, stronger once ridden and strongest for the current one, so the power and
/// heart rate lines stay readable over it. Grey without an FTP to place it in a zone.
struct WorkoutTargetShade: Equatable {
  enum Stage: Equatable {
    case ridden, current, upcoming
  }

  let stage: Stage
  /// The zone of the interval's planned power, or nil without an FTP.
  let zone: PowerZone?

  init(interval: RideSession.Interval, position: TimeInterval, ftp: Int?) {
    if interval.end <= position {
      stage = .ridden
    } else {
      stage = interval.start <= position ? .current : .upcoming
    }
    zone = ftp.flatMap { $0 > 0 ? PowerZone.zone(power: interval.plannedPower, ftp: $0) : nil }
  }

  var opacity: Double {
    switch (stage, zone) {
    case (.upcoming, nil): 0.08
    case (.ridden, nil): 0.16
    case (.current, nil): 0.32
    case (.upcoming, _): 0.25
    case (.ridden, _): 0.4
    case (.current, _): 0.65
    }
  }

  var color: Color { (zone?.color ?? .primary).opacity(opacity) }
}
