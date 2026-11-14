import Foundation
import RideData

public struct HeadlessRide: Sendable {
  public enum Event: Equatable, Sendable {
    case trainerDrops(forSeconds: Int)
    case rider(RideInput)
  }

  public struct Outcome: Sendable {
    public let trace: RideTrace
    public let engine: RideEngine
    public let rider: SimulatedRider

    public var finishedWithoutCracking: Bool { engine.session.isComplete && !rider.hasCracked }
  }

  public var header: RideTrace.Header
  public var events: [Int: [Event]]

  public static let resumeDelayAfterReconnectSeconds = 5
  public static let longestRideShareOfWorkout = 3.0

  public init(
    _ template: WorkoutTemplate, ftp: Int, riderWeight: Double = 75,
    startDate: Date = Date(timeIntervalSince1970: 1_800_000_000), events: [Int: [Event]] = [:]
  ) {
    self.init(
      template.planned, ftp: ftp, riderWeight: riderWeight, startDate: startDate, events: events)
  }

  public init(
    _ workout: PlannedWorkout, ftp: Int, riderWeight: Double = 75,
    startDate: Date = Date(timeIntervalSince1970: 1_800_000_000), events: [Int: [Event]] = [:]
  ) {
    header = .init(workout: workout, ftp: ftp, startDate: startDate, riderWeight: riderWeight)
    self.events = events
  }

  public func run(with rider: SimulatedRider) -> Outcome {
    var rider = rider
    var trace = RideTrace(header: header)
    var engine = RideEngine(session: trace.freshSession())
    func apply(_ input: RideInput) {
      trace.inputs.append(input)
      engine.apply(input)
    }
    var trainerBackAt: Int?
    apply(.begin(trainerConnected: true))
    let lastSecond = Int(engine.session.duration * Self.longestRideShareOfWorkout)
    for second in 0..<lastSecond where !engine.session.isComplete {
      for event in events[second] ?? [] {
        switch event {
        case .trainerDrops(let seconds): trainerBackAt = second + seconds
        case .rider(let input): apply(input)
        }
      }
      let connected = trainerBackAt.map { second >= $0 } ?? true
      if let back = trainerBackAt, connected, engine.isPausedForTrainer,
        second >= back + Self.resumeDelayAfterReconnectSeconds
      {
        apply(.togglePause)
        trainerBackAt = nil
      }
      var reading = rider.reading(for: engine.session, after: 1)
      if !connected {
        reading.power = nil
        reading.cadence = nil
      }
      apply(.tick(seconds: 1, reading: reading, trainerConnected: connected))
    }
    return Outcome(trace: trace, engine: engine, rider: rider)
  }
}
