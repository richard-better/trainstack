import Foundation

/// A structured workout: steps that each ask the trainer to hold a power for a while.
public struct Workout: Equatable, Sendable {
  public struct Step: Equatable, Sendable {
    public var duration: TimeInterval
    /// Watts.
    public var targetPower: Int

    public init(duration: TimeInterval, targetPower: Int) {
      self.duration = duration
      self.targetPower = targetPower
    }
  }

  public var name: String
  public var steps: [Step]

  public init(name: String, steps: [Step]) {
    self.name = name
    self.steps = steps
  }

  /// The power asked for `elapsed` seconds in, or nil once the workout is over.
  public func targetPower(at elapsed: TimeInterval) -> Int? {
    var end: TimeInterval = 0
    for step in steps {
      end += step.duration
      if elapsed < end { return step.targetPower }
    }
    return nil
  }
}

public struct TargetSegment: Equatable, Sendable {
  public var start: TimeInterval
  public var end: TimeInterval
  public var power: Int
}

extension RideRecording {
  /// This ride as if it had been recorded while following `workout`.
  public func applying(_ workout: Workout) -> RideRecording {
    var result = self
    result.workoutName = workout.name
    for index in result.samples.indices {
      result.samples[index].targetPower = workout.targetPower(at: samples[index].elapsed)
    }
    return result
  }

  /// Stretches of the ride held at one target power, in order. Steps asking for the same power
  /// back to back form one segment.
  public var targetSegments: [TargetSegment] {
    var segments: [TargetSegment] = []
    var open: (start: TimeInterval, power: Int)?
    for sample in samples {
      if let open, sample.targetPower != open.power {
        segments.append(.init(start: open.start, end: sample.elapsed, power: open.power))
      }
      if let power = sample.targetPower, power != open?.power {
        open = (sample.elapsed, power)
      } else if sample.targetPower == nil {
        open = nil
      }
    }
    if let open, let last = samples.last {
      segments.append(.init(start: open.start, end: last.elapsed, power: open.power))
    }
    return segments
  }

  /// The share of the ride, from 0 to 1, spent within `tolerance` of the target power. A missing
  /// power reading counts as off target. Nil when the ride had no target.
  public func timeOnTarget(tolerance: Double = 0.05) -> Double? {
    let targeted = samples.filter { $0.targetPower != nil }
    guard !targeted.isEmpty else { return nil }
    let onTarget = targeted.filter { sample in
      guard let power = sample.power, let target = sample.targetPower else { return false }
      return abs(Double(power - target)) <= Double(target) * tolerance
    }
    return Double(onTarget.count) / Double(targeted.count)
  }
}
