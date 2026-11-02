import Foundation

public struct RideSession: Sendable {
  public struct Interval: Equatable, Identifiable, Sendable {
    public var index: Int
    public var start: TimeInterval
    public var end: TimeInterval
    public var plannedPower: Int
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
  public let intervals: [Interval]
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
  public private(set) var distanceMetres: Double = 0
  private var bike: VirtualBike

  public init(
    workout: Workout, startDate: Date = .now, riderWeight: Double = RiderSettings.defaultWeight
  ) {
    self.workout = workout
    self.startDate = startDate
    bike = VirtualBike(riderWeight: riderWeight)
    var start: TimeInterval = 0
    intervals = workout.steps.enumerated().map { index, step in
      defer { start += step.duration }
      return Interval(
        index: index, start: start, end: start + step.duration, plannedPower: step.targetPower)
    }
  }

  public var duration: TimeInterval { intervals.last?.end ?? 0 }

  public var speedMetresPerSecond: Double { bike.speedMetresPerSecond }

  private var roadGradeFraction: Double { mode == .slope ? slopeGradePercent / 100 : 0 }

  public func power(_ display: PowerDisplay) -> Int? {
    recentPower.average(over: display.window)
  }

  public var currentInterval: Interval? {
    intervals.first { position < $0.end }
  }

  public var nextInterval: Interval? {
    currentInterval.flatMap {
      intervals.indices.contains($0.index + 1) ? intervals[$0.index + 1] : nil
    }
  }

  public var isComplete: Bool { currentInterval == nil }

  public var intervalRemaining: TimeInterval? {
    currentInterval.map { $0.end - position }
  }

  public var remaining: TimeInterval { duration - position }

  public var targetPower: Int? {
    guard mode == .erg, let interval = currentInterval else { return nil }
    return adjusted(interval.plannedPower)
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
    position = min(position + duration, self.duration)
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
    position = interval.end
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
