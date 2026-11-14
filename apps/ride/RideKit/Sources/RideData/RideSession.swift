import Foundation

public struct RideSession: Sendable {
  public struct Interval: Equatable, Identifiable, Sendable {
    public var index: Int
    public var stepIndex: Int
    public var start: TimeInterval
    public var end: TimeInterval
    public var step: Workout.Step

    public func plannedPower(at position: TimeInterval) -> Int? {
      step.targetPower(atOffset: position - start)
    }

    public var averagePlannedPower: Int? { step.target?.averagePower }

    public func zone(ftp: Int) -> PowerZone? { step.target?.zone(ftp: ftp) }
  }

  public struct LapMark: Equatable, Sendable {
    public var start: TimeInterval
    public var stepIndex: Int?
    public var endedBy: LapTrigger?
  }

  private struct Planned: Sendable {
    var stepIndex: Int
    var ridden: TimeInterval?
    var added: TimeInterval = 0
  }

  public struct LiveSample: Equatable, Sendable {
    public var position: TimeInterval
    public var sample: RideRecording.Sample
  }

  public static let ergPercentRange = 50...150
  public static let slopeGradePercentRange = -10.0...20.0
  public static let slopeGradePercentStep = 0.5
  public static let levelRange = 1...20

  public let workout: Workout
  public let startDate: Date
  public let utcOffsetSeconds: Int?
  public private(set) var intervals: [Interval] = []
  private var current = 0
  private var timeline: [Planned]
  private let hasLapSteps: Bool
  public private(set) var elapsed: TimeInterval = 0
  public private(set) var position: TimeInterval = 0
  public private(set) var isPaused = false
  public var mode: TrainerMode = .erg
  public private(set) var ergPercent = 100
  public private(set) var slopeGradePercent = 2.0
  public private(set) var level = 6
  public private(set) var latest = TrainerReading()
  public private(set) var recentPower = PowerAverage()
  public private(set) var samples: [LiveSample] = []
  public private(set) var lapMarks: [LapMark] = []
  public private(set) var distanceMetres: Double = 0
  private var bike: VirtualBike

  public init(
    workout: Workout, startDate: Date = .now, utcOffsetSeconds: Int? = nil,
    riderWeight: Double = RiderSettings.defaultWeight
  ) {
    self.workout = workout
    self.startDate = startDate
    self.utcOffsetSeconds = utcOffsetSeconds
    bike = VirtualBike(riderWeight: riderWeight)
    hasLapSteps = workout.steps.contains(where: \.endsOnLap)
    timeline = workout.steps.indices.map { Planned(stepIndex: $0) }
    layOut()
    moveOnFromFinishedIntervals()
    lapMarks = [LapMark(start: 0, stepIndex: currentInterval?.stepIndex)]
  }

  private mutating func layOut() {
    var start: TimeInterval = 0
    intervals = timeline.enumerated().map { index, planned in
      let step = workout.steps[planned.stepIndex]
      let length =
        switch (step.endsOnLap, planned.ridden) {
        case (_, let ridden?): ridden
        case (false, nil): step.duration + planned.added
        case (true, nil) where index == current: max(position - start, 0)
        case (true, nil): step.untilLap?.expectedSeconds ?? 0
        }
      defer { start += length }
      return Interval(
        index: index, stepIndex: planned.stepIndex, start: start, end: start + length, step: step)
    }
  }

  private mutating func moveOnFromFinishedIntervals(endingLapBy trigger: LapTrigger = .time) {
    var trigger = trigger
    while let interval = currentInterval, !interval.step.endsOnLap, position >= interval.end {
      current += 1
      if hasLapSteps { layOut() }
      beginLap(at: elapsed - (position - interval.end), endingTheLastBy: trigger)
      trigger = .time
    }
    if isComplete { position = min(position, duration) }
  }

  public var duration: TimeInterval { intervals.last?.end ?? 0 }

  public var speedMetresPerSecond: Double { bike.speedMetresPerSecond }

  private var roadGradeFraction: Double { mode == .slope ? slopeGradePercent / 100 : 0 }

  public func power(_ display: PowerDisplay) -> Int? {
    recentPower.average(over: display.window)
  }

  public var currentInterval: Interval? {
    intervals.indices.contains(current) ? intervals[current] : nil
  }

  public var awaitsLap: Bool { currentInterval?.step.endsOnLap == true }

  public var hasLapStepsAhead: Bool {
    intervals.dropFirst(current).contains { $0.step.endsOnLap }
  }

  public var nextInterval: Interval? {
    currentInterval.flatMap {
      intervals.indices.contains($0.index + 1) ? intervals[$0.index + 1] : nil
    }
  }

  public var isComplete: Bool { currentInterval == nil }

  public var intervalRemaining: TimeInterval? {
    guard !awaitsLap else { return nil }
    return currentInterval.map { $0.end - position }
  }

  public var intervalElapsed: TimeInterval? {
    currentInterval.map { position - $0.start }
  }

  public var remaining: TimeInterval {
    guard hasLapSteps else { return duration - position }
    return intervals.dropFirst(current).reduce(0) { total, interval in
      guard !interval.step.endsOnLap else { return total }
      return total + interval.end - max(interval.start, position)
    }
  }

  public var targetPower: Int? {
    guard mode == .erg, let planned = currentInterval?.plannedPower(at: position) else {
      return nil
    }
    return adjusted(planned)
  }

  public var cue: PlannedCue? {
    guard !isComplete else { return nil }
    return intervals.prefix(current + 1).reversed().lazy.compactMap { interval in
      let lapped = interval.step.endsOnLap && interval.index < current
      return interval.step.cues.last { cue in
        cue.isShowing(atOffset: self.position - interval.start)
          && !(lapped && cue.at >= interval.end - interval.start)
      }
    }
    .first
  }

  public func adjusted(_ plannedPower: Int) -> Int {
    Int((Double(plannedPower * ergPercent) / 100).rounded())
  }

  public mutating func advance(by duration: TimeInterval, reading: TrainerReading) {
    latest = reading
    recentPower.record(reading.power, over: duration)
    guard !isPaused, duration > 0 else { return }
    let target = targetPower
    elapsed += duration
    position += duration
    if awaitsLap { layOut() }
    moveOnFromFinishedIntervals()
    distanceMetres += bike.ride(
      power: Double(reading.power ?? 0), gradeFraction: roadGradeFraction, for: duration)
    samples.append(
      LiveSample(
        position: position,
        sample: .init(
          elapsed: elapsed, power: reading.power, targetPower: target,
          heartRate: reading.heartRate, cadence: reading.cadence,
          speedMetresPerSecond: speedMetresPerSecond, distanceMetres: distanceMetres)))
  }

  public mutating func togglePause() { isPaused.toggle() }

  public mutating func pause() { isPaused = true }

  public mutating func skipInterval() {
    guard let interval = currentInterval else { return }
    if interval.step.endsOnLap {
      timeline[current].ridden = position - interval.start
      current += 1
      layOut()
      beginLap(at: elapsed, endingTheLastBy: .manual)
      moveOnFromFinishedIntervals()
    } else {
      position = interval.end
      moveOnFromFinishedIntervals(endingLapBy: .manual)
    }
  }

  public var canExtendInterval: Bool { currentInterval.map { !$0.step.endsOnLap } ?? false }

  public mutating func extendInterval(by seconds: TimeInterval) {
    guard seconds > 0, canExtendInterval else { return }
    timeline[current].added += seconds
    layOut()
  }

  public mutating func previousInterval() {
    guard let last = timeline.last else { return }
    if let interval = currentInterval {
      let stepIndex = interval.stepIndex
      let again =
        stepIndex > 0
        ? [Planned(stepIndex: stepIndex - 1), Planned(stepIndex: stepIndex)]
        : [Planned(stepIndex: stepIndex)]
      let ridden = position - interval.start
      if ridden > 0 {
        timeline[current].ridden = ridden
        current += 1
      } else {
        timeline.remove(at: current)
      }
      timeline.insert(contentsOf: again, at: current)
    } else {
      timeline.append(Planned(stepIndex: last.stepIndex))
    }
    layOut()
    beginLap(at: elapsed, endingTheLastBy: .manual)
    moveOnFromFinishedIntervals()
  }

  public var freeRideElapsed: TimeInterval? {
    guard isComplete, let lap = lapMarks.last, lap.stepIndex == nil else { return nil }
    return elapsed - lap.start
  }

  public mutating func markLap() {
    if awaitsLap {
      skipInterval()
    } else {
      beginLap(at: elapsed, endingTheLastBy: .manual)
    }
  }

  public var currentLap: LapMark? { lapMarks.last }

  private mutating func beginLap(at start: TimeInterval, endingTheLastBy trigger: LapTrigger) {
    let next = LapMark(start: start, stepIndex: currentInterval?.stepIndex)
    guard let last = lapMarks.indices.last, lapMarks[last].start < start else {
      if lapMarks.isEmpty { lapMarks = [next] } else { lapMarks[lapMarks.count - 1] = next }
      return
    }
    lapMarks[last].endedBy = trigger
    lapMarks.append(next)
  }

  public mutating func adjust(by steps: Int) {
    switch mode {
    case .erg:
      ergPercent = (ergPercent + steps).clamped(to: Self.ergPercentRange)
    case .slope:
      slopeGradePercent = (slopeGradePercent + Double(steps) * Self.slopeGradePercentStep)
        .clamped(to: Self.slopeGradePercentRange)
    case .level:
      level = (level + steps).clamped(to: Self.levelRange)
    }
  }

  public var intervalAveragePower: Int? {
    guard let interval = currentInterval else { return nil }
    let ridden = samples.reversed().prefix { $0.endsAfterTheStart(of: interval) }
    return Self.average(ridden.compactMap(\.sample.power))
  }

  private func recordedLaps(_ recorded: [RideRecording.Sample]) -> [RideLap] {
    let ends = lapMarks.dropFirst().map(\.start) + [elapsed]
    return zip(lapMarks, ends).compactMap { mark, end in
      guard end > mark.start || lapMarks.count == 1 else { return nil }
      return RideLap(
        from: mark.start, to: end, trigger: mark.endedBy ?? .sessionEnd,
        stepIndex: mark.stepIndex, samples: recorded)
    }
  }

  private static func average(_ values: [Int]) -> Int? {
    values.isEmpty ? nil : Int((Double(values.reduce(0, +)) / Double(values.count)).rounded())
  }

  public func recording() -> RideRecording {
    let recorded = samples.map(\.sample)
    let powers = recorded.compactMap(\.power)
    let heartRates = recorded.compactMap(\.heartRate)
    let average = Self.average
    return RideRecording(
      startDate: startDate, workoutName: workout.name, sport: .cycling, samples: recorded,
      laps: recordedLaps(recorded), utcOffsetSeconds: utcOffsetSeconds,
      summary: .init(
        duration: elapsed, distanceMetres: distanceMetres > 0 ? distanceMetres : nil,
        averagePower: average(powers), maxPower: powers.max(),
        averageHeartRate: average(heartRates), maxHeartRate: heartRates.max()))
  }
}

extension Comparable {
  fileprivate func clamped(to range: ClosedRange<Self>) -> Self {
    min(max(self, range.lowerBound), range.upperBound)
  }
}

extension RideSession.Interval {
  public var id: Int { index }
}

extension RideSession.LiveSample {
  fileprivate func endsAfterTheStart(of interval: RideSession.Interval) -> Bool {
    position > interval.start
  }
}
