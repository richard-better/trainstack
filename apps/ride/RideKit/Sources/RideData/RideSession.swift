import Foundation

/// How the trainer sets resistance.
public enum TrainerMode: String, CaseIterable, Codable, Sendable {
  /// Holds the workout's target power whatever the cadence.
  case erg = "ERG"
  /// Rides like a road of the chosen gradient.
  case slope = "Slope"
  /// A fixed resistance step, like a dumb trainer.
  case level = "Level"
}

/// One moment of live data from the trainer and sensors. Any of it can be missing.
///
/// There is no speed: what a trainer reports depends on its gear in ERG mode, and many do not
/// report it at all, so the session works it out from power instead.
public struct TrainerReading: Equatable, Sendable {
  public var power: Int?
  public var cadence: Int?
  public var heartRate: Int?
  /// Where `heartRate` came from.
  public var heartRateSource: HeartRateSource?

  public init(
    power: Int? = nil, cadence: Int? = nil, heartRate: Int? = nil,
    heartRateSource: HeartRateSource? = nil
  ) {
    self.power = power
    self.cadence = cadence
    self.heartRate = heartRate
    self.heartRateSource = heartRateSource
  }
}

/// A workout being ridden: where the rider is in it, what the trainer is asked for, and what has
/// been recorded so far.
///
/// Ride time and workout time are kept apart. Ride time stops while paused; workout time also
/// jumps ahead when an interval is skipped.
public struct RideSession: Sendable {
  public struct Interval: Equatable, Identifiable, Sendable {
    public var index: Int
    public var start: TimeInterval
    public var end: TimeInterval
    /// The power the workout asks for, before any ERG adjustment.
    public var plannedPower: Int
  }

  /// A recorded sample and where in the workout it was taken.
  public struct LiveSample: Equatable, Codable, Sendable {
    public var position: TimeInterval
    public var sample: RideRecording.Sample
  }

  public static let ergPercentRange = 50...150
  public static let gradeRange = -10.0...20.0
  public static let levelRange = 1...20

  public let workout: Workout
  public let startDate: Date
  public let intervals: [Interval]
  /// Time spent riding, without pauses.
  public private(set) var elapsed: TimeInterval = 0
  /// How far into the workout the rider is.
  public private(set) var position: TimeInterval = 0
  public private(set) var isPaused = false
  public var mode: TrainerMode = .erg
  /// Scales every ERG target, for a day the workout feels too hard or too easy.
  public private(set) var ergPercent = 100
  /// Percent gradient in slope mode.
  public private(set) var grade = 2.0
  public private(set) var level = 6
  public private(set) var latest = TrainerReading()
  /// The last few seconds of power, paused or not, for the player to show it smoothed.
  public private(set) var recentPower = PowerAverage()
  public private(set) var samples: [LiveSample] = []
  /// Metres.
  public private(set) var distance: Double = 0
  /// The rider on the virtual road, which their power moves along.
  private var bike: VirtualBike

  /// Where the rider is and how the trainer is set: all of a session that is not its samples,
  /// which is what a ride needs saved to be picked up again.
  public struct State: Equatable, Codable, Sendable {
    public var elapsed: TimeInterval
    public var position: TimeInterval
    public var isPaused: Bool
    public var mode: TrainerMode
    public var ergPercent: Int
    public var grade: Double
    public var level: Int
    public var distance: Double
  }

  /// A session for a rider of `riderWeight` kilograms, which sets their speed for their power.
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

  /// A session carried on from `state`, with the `samples` already recorded. The bike starts
  /// from rest.
  public init(
    workout: Workout, startDate: Date, riderWeight: Double = RiderSettings.defaultWeight,
    state: State, samples: [LiveSample]
  ) {
    self.init(workout: workout, startDate: startDate, riderWeight: riderWeight)
    elapsed = state.elapsed
    position = min(state.position, duration)
    isPaused = state.isPaused
    mode = state.mode
    ergPercent = state.ergPercent.clamped(to: Self.ergPercentRange)
    grade = state.grade.clamped(to: Self.gradeRange)
    level = state.level.clamped(to: Self.levelRange)
    distance = state.distance
    self.samples = samples
  }

  public var state: State {
    State(
      elapsed: elapsed, position: position, isPaused: isPaused, mode: mode,
      ergPercent: ergPercent, grade: grade, level: level, distance: distance)
  }

  public var duration: TimeInterval { intervals.last?.end ?? 0 }

  /// Metres per second along the virtual road.
  public var speed: Double { bike.speed }

  /// The gradient of the virtual road, as a fraction: the set grade in slope mode, and flat
  /// otherwise.
  private var roadGrade: Double { mode == .slope ? grade / 100 : 0 }

  /// Power as the rider chose to see it: the latest reading, or the average of the last few
  /// seconds.
  public func power(_ display: PowerDisplay) -> Int? {
    recentPower.average(over: display.window)
  }

  /// The interval being ridden, or nil once the workout is done.
  public var currentInterval: Interval? {
    intervals.first { position < $0.end }
  }

  /// The interval after the current one, or nil on the last interval and once the workout is
  /// done.
  public var nextInterval: Interval? {
    currentInterval.flatMap {
      intervals.indices.contains($0.index + 1) ? intervals[$0.index + 1] : nil
    }
  }

  public var isComplete: Bool { currentInterval == nil }

  public var intervalRemaining: TimeInterval? {
    currentInterval.map { $0.end - position }
  }

  /// Workout time still to ride. Skipping an interval takes its time off.
  public var remaining: TimeInterval { duration - position }

  /// The power the trainer is asked to hold, in ERG mode while the workout lasts.
  public var targetPower: Int? {
    guard mode == .erg, let interval = currentInterval else { return nil }
    return adjusted(interval.plannedPower)
  }

  /// An interval's power with the rider's ERG adjustment applied.
  public func adjusted(_ plannedPower: Int) -> Int {
    Int((Double(plannedPower * ergPercent) / 100).rounded())
  }

  /// Moves time on by `duration` and records `reading` for it. While paused only the reading
  /// is kept, so the screen stays live, and nothing is recorded.
  public mutating func advance(by duration: TimeInterval, reading: TrainerReading) {
    latest = reading
    recentPower.record(reading.power, over: duration)
    guard !isPaused, duration > 0 else { return }
    let target = targetPower
    elapsed += duration
    position = min(position + duration, self.duration)
    distance += bike.ride(power: Double(reading.power ?? 0), grade: roadGrade, for: duration)
    samples.append(
      LiveSample(
        position: position,
        sample: .init(
          elapsed: elapsed, power: reading.power, targetPower: target,
          heartRate: reading.heartRate, cadence: reading.cadence, speed: speed,
          distance: distance)))
  }

  public mutating func togglePause() { isPaused.toggle() }

  public mutating func pause() { isPaused = true }

  /// Moves on to the start of the next interval, or to the end of the workout from the last.
  public mutating func skipInterval() {
    guard let interval = currentInterval else { return }
    position = interval.end
  }

  /// Nudges the setting of the current mode up or down by `steps`: 1% of ERG target, half a
  /// percent of gradient, or one resistance level.
  public mutating func adjust(by steps: Int) {
    switch mode {
    case .erg:
      ergPercent = (ergPercent + steps).clamped(to: Self.ergPercentRange)
    case .slope:
      grade = (grade + Double(steps) * 0.5).clamped(to: Self.gradeRange)
    case .level:
      level = (level + steps).clamped(to: Self.levelRange)
    }
  }

  /// Average power over the current interval so far, or nil before it has any. Only recorded
  /// samples count, so paused time does not, and skipping to an interval starts it afresh.
  public var intervalAveragePower: Int? {
    guard let interval = currentInterval else { return nil }
    // A sample's position is where it ended, so one ending at the start belongs to the interval
    // before.
    let ridden = samples.reversed().prefix { $0.position > interval.start }
    return Self.average(ridden.compactMap(\.sample.power))
  }

  private static func average(_ values: [Int]) -> Int? {
    values.isEmpty ? nil : Int((Double(values.reduce(0, +)) / Double(values.count)).rounded())
  }

  /// What has been ridden so far, as a finished ride.
  public func recording() -> RideRecording {
    let recorded = samples.map(\.sample)
    let powers = recorded.compactMap(\.power)
    let heartRates = recorded.compactMap(\.heartRate)
    let average = Self.average
    return RideRecording(
      startDate: startDate, workoutName: workout.name, sport: .cycling, samples: recorded,
      summary: .init(
        duration: elapsed, distance: distance > 0 ? distance : nil,
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
