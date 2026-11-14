import RideData
import RideStyle
import SwiftUI

struct WorkoutTargetShade: Equatable {
  enum Stage: Equatable {
    case ridden, current, upcoming
  }

  let stage: Stage
  let zone: PowerZone?

  init(
    interval: RideSession.Interval, position: TimeInterval, ftp: Int?,
    awaitingLapAt lapIndex: Int? = nil
  ) {
    if let lapIndex, interval.index >= lapIndex {
      stage = interval.index == lapIndex ? .current : .upcoming
    } else if interval.end <= position {
      stage = .ridden
    } else {
      stage = interval.start <= position ? .current : .upcoming
    }
    zone = ftp.flatMap { interval.zone(ftp: $0) }
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
