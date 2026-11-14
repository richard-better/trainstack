import Foundation
import RideData

public struct RideEngine: Sendable {
  public private(set) var session: RideSession
  public private(set) var isPausedForTrainer = false
  public private(set) var powerMatch = PowerMatch()
  public private(set) var rampEndedAt: TimeInterval?
  private var secondsBelowRamp: TimeInterval = 0
  private var trainerWasConnected = false

  public init(session: RideSession) {
    self.session = session
  }

  public init(replaying inputs: some Sequence<RideInput>, from session: RideSession) {
    self.init(session: session)
    for input in inputs { apply(input) }
  }

  @discardableResult
  public mutating func apply(_ input: RideInput) -> RideSession.LiveSample? {
    switch input {
    case .begin(let trainerConnected):
      trainerWasConnected = trainerConnected
    case .resumeAfterCrash(let trainerConnected):
      trainerWasConnected = trainerConnected
      isPausedForTrainer = false
      session.pause()
    case .tick(let seconds, let reading, let trainerConnected):
      pauseIfTrainerDropped(trainerConnected: trainerConnected)
      let commanded = session.isPaused ? nil : commandedWatts
      let rampTarget = session.isPaused ? nil : rampTargetWatts
      let recorded = session.samples.count
      session.advance(by: seconds, reading: reading)
      powerMatch.observe(reading.powerMatch, commanded: commanded, over: seconds)
      endRampIfItIsBeyondTheRider(target: rampTarget, power: reading.power, over: seconds)
      return session.samples.count > recorded ? session.samples.last : nil
    case .togglePause:
      isPausedForTrainer = false
      session.togglePause()
    case .skipInterval:
      session.skipInterval()
    case .markLap:
      session.markLap()
    case .extendInterval(let seconds):
      session.extendInterval(by: TimeInterval(seconds))
    case .previousInterval:
      session.previousInterval()
    case .adjust(let steps):
      session.adjust(by: steps)
    case .changeMode(let mode):
      session.mode = mode
    }
    return nil
  }

  private mutating func pauseIfTrainerDropped(trainerConnected: Bool) {
    defer { trainerWasConnected = trainerConnected }
    guard trainerWasConnected, !trainerConnected, !session.isPaused else { return }
    session.pause()
    isPausedForTrainer = true
  }

  private var rampTargetWatts: Int? {
    guard let ramp = session.workout.rampSteps, let interval = session.currentInterval,
      ramp.contains(interval.stepIndex),
      let planned = interval.plannedPower(at: session.position)
    else { return nil }
    return session.adjusted(planned)
  }

  private mutating func endRampIfItIsBeyondTheRider(
    target: Int?, power: Int?, over seconds: TimeInterval
  ) {
    guard let target else {
      secondsBelowRamp = 0
      return
    }
    if Double(power ?? 0) < Double(target) * RampTest.endsBelowShareOfTarget {
      secondsBelowRamp += seconds
    } else {
      secondsBelowRamp = 0
    }
    guard secondsBelowRamp >= RampTest.endsAfterSecondsBelow,
      let ramp = session.workout.rampSteps
    else { return }
    secondsBelowRamp = 0
    rampEndedAt = session.elapsed
    while let interval = session.currentInterval, ramp.contains(interval.stepIndex) {
      session.skipInterval()
    }
  }

  private var commandedWatts: Int? {
    guard case .power(let watts) = trainerCommand else { return nil }
    return watts
  }

  public var trainerCommand: TrainerCommand {
    switch session.mode {
    case .erg:
      session.targetPower.map { .power(watts: powerMatch.watts(for: $0)) } ?? .grade(percent: 0)
    case .slope: .grade(percent: session.slopeGradePercent)
    case .level:
      .resistance(
        shareOfRange: Double(session.level) / Double(RideSession.levelRange.upperBound))
    }
  }
}
