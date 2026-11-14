import Foundation

public struct Workout: Equatable, Sendable {
  public struct Step: Equatable, Sendable {
    public var duration: TimeInterval
    public var target: StepTarget?
    public var cadence: TargetLevel?
    public var name: String?
    public var notes: String?
    public var cues: [PlannedCue]
    public var untilLap: UntilLap?

    public init(
      duration: TimeInterval, target: StepTarget?, cadence: TargetLevel? = nil,
      name: String? = nil, notes: String? = nil, cues: [PlannedCue] = [],
      untilLap: UntilLap? = nil
    ) {
      self.duration = duration
      self.target = target
      self.cadence = cadence
      self.name = name
      self.notes = notes
      self.cues = cues
      self.untilLap = untilLap
    }

    public var endsOnLap: Bool { untilLap != nil }

    public init(duration: TimeInterval, targetPower: Int) {
      self.init(duration: duration, target: .power(.constant(Double(targetPower))))
    }

    public func targetPower(atOffset offset: TimeInterval) -> Int? {
      target?.power(atShareOfStep: duration > 0 ? offset / duration : 0)
    }
  }

  public var name: String
  public var steps: [Step]

  public init(name: String, steps: [Step]) {
    self.name = name
    self.steps = steps
  }

  public func targetPower(at elapsed: TimeInterval) -> Int? {
    var start: TimeInterval = 0
    for step in steps {
      let end = start + step.duration
      if elapsed < end { return step.targetPower(atOffset: elapsed - start) }
      start = end
    }
    return nil
  }
}

extension RideRecording {
  public func applying(_ workout: Workout) -> RideRecording {
    var result = self
    result.workoutName = workout.name
    for index in result.samples.indices {
      result.samples[index].targetPower = workout.targetPower(at: samples[index].elapsed)
    }
    return result
  }

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
