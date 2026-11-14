import Foundation
import RideData
import Testing

@testable import RideCore

struct PowerMatchTests {
  private static let steps = [
    (seconds: 180, watts: 150), (120, 300), (120, 150), (180, 250), (60, 350), (120, 100),
    (120, 200),
  ]
  private static let largestOvershootShareOfStep = 0.10
  private static let longestSettlingSeconds = 10
  private static let longestFirstSettlingSeconds = 45
  private static let largestSteadyError = 0.005
  private static let largestCommandSwingWatts = 4
  private static let steadyFrom = 15
  private static let addedOvershootShare = 0.02

  @Test(arguments: [0.92, 0.95, 0.97, 1.03, 1.05, 1.08])
  func plainErgLeavesTheMeterOffByItsOwnError(meterFactor: Double) {
    let run = PowerMatchRun(Self.steps, meterFactor: meterFactor, matching: false)
    for interval in run.intervals {
      #expect(abs(run.steadyError(in: interval) - (meterFactor - 1)) < 0.003)
    }
  }

  @Test(arguments: [0.92, 0.95, 0.97, 1.03, 1.05, 1.08])
  func holdsAMeterThreeToEightPercentOffOnTargetWithoutAddingOvershoot(meterFactor: Double)
    throws
  {
    let run = PowerMatchRun(Self.steps, meterFactor: meterFactor)
    let plain = PowerMatchRun(Self.steps, meterFactor: meterFactor, matching: false)
    let first = try #require(run.intervals.first)
    let firstSettling = try #require(run.settlingSeconds(in: first, within: 0.02))
    #expect(firstSettling <= Self.longestFirstSettlingSeconds)
    for (interval, plainInterval) in zip(run.intervals, plain.intervals).dropFirst() {
      let overshoot = run.overshootShareOfStep(in: interval)
      #expect(overshoot <= Self.largestOvershootShareOfStep)
      #expect(overshoot <= plain.overshootShareOfStep(in: plainInterval) + Self.addedOvershootShare)
      let settling = try #require(run.settlingSeconds(in: interval, within: 0.02))
      #expect(settling <= Self.longestSettlingSeconds)
      #expect(abs(run.steadyError(in: interval)) <= Self.largestSteadyError)
      #expect(
        run.commandSwing(in: interval, after: Self.steadyFrom) <= Self.largestCommandSwingWatts)
    }
  }

  @Test func aBriefMeterDropoutHoldsTheCorrection() {
    let run = PowerMatchRun(Self.steps, meterFactor: 1.05, faults: [(600..<603, .meterSilent)])
    #expect(abs(run.seconds[603].ratio - run.seconds[599].ratio) < 0.002)
    #expect(run.seconds[600..<606].allSatisfy { $0.commanded != $0.target })
  }

  @Test func aMeterThatGoesAwayFallsBackToPlainErgAndIsLearntAgainWhenItReturns() throws {
    let run = PowerMatchRun(Self.steps, meterFactor: 1.05, faults: [(600..<640, .meterSilent)])
    let silenced = 600 + Int(PowerMatch.meterSilenceSeconds)
    #expect(run.seconds[silenced..<640].allSatisfy { $0.commanded == $0.target })
    let interval = run.intervals[3]
    #expect(abs(run.steadyError(in: interval)) <= Self.largestSteadyError)
  }

  @Test func aMeterSendingZerosWhileTheTrainerReadsPowerFallsBackToPlainErg() {
    let run = PowerMatchRun(Self.steps, meterFactor: 0.95, faults: [(600..<620, .meterReadsZero)])
    let silenced = 600 + Int(PowerMatch.meterSilenceSeconds)
    #expect(run.seconds[silenced..<620].allSatisfy { $0.commanded == $0.target })
  }

  @Test func aRiderWhoStopsPedallingWindsNothingUpAndSettlesWhenTheyRideAgain() throws {
    let run = PowerMatchRun(Self.steps, meterFactor: 1.06, faults: [(450..<480, .riderStops)])
    let before = run.seconds[449]
    #expect(run.seconds[450..<480].allSatisfy { abs($0.ratio - before.ratio) < 0.001 })
    #expect(
      run.seconds[450..<481].allSatisfy { abs(($0.commanded ?? 0) - (before.commanded ?? 0)) <= 1 })
    let target = 250.0
    let afterwards = run.seconds[480..<600]
    let peak = try #require(afterwards.map(\.trueMeter).max())
    #expect(peak <= target * (1 + Self.largestOvershootShareOfStep))
    let lastOutside = try #require(
      afterwards.lastIndex { abs($0.trueMeter - target) > 0.02 * target })
    #expect(lastOutside - 480 < Self.longestSettlingSeconds + 5)
  }

  @Test(arguments: [0.75, 0.85, 1.15, 1.3])
  func neverCorrectsByMoreThanItsBound(meterFactor: Double) {
    let run = PowerMatchRun(Self.steps, meterFactor: meterFactor)
    for second in run.seconds {
      guard let target = second.target, let commanded = second.commanded else { continue }
      #expect(
        Double(abs(commanded - target))
          <= PowerMatch.largestCorrection * Double(target) + 0.5)
    }
  }

  @Test func barelyCorrectsForAMeterTooFarOffToBeMeasuringTheSameRide() {
    let run = PowerMatchRun(Self.steps, meterFactor: 1.4)
    #expect(run.seconds.allSatisfy { abs($0.ratio - 1) < 0.01 })
  }

  @Test func shortIntervalsOnAndOffDoNotWindTheCorrectionUp() throws {
    let onOff = Array(repeating: [(seconds: 30, watts: 320), (30, 140)], count: 20).flatMap { $0 }
    let steps = [(seconds: 180, watts: 150)] + onOff
    let run = PowerMatchRun(steps, meterFactor: 1.06)
    let settled = run.seconds[180...].map(\.ratio)
    let truth = 1 / 1.06
    #expect(settled.allSatisfy { abs($0 - truth) < 0.01 })
  }

  @Test func withoutAMeterTheTrainerGetsTheTargetAsIs() {
    let run = PowerMatchRun(Self.steps, meterFactor: 1.05, matching: false)
    #expect(run.seconds.allSatisfy { $0.commanded == $0.target })
  }

  @Test func replayingTheInputsRebuildsTheSameCorrection() {
    let run = PowerMatchRun(Self.steps, meterFactor: 1.05, faults: [(600..<640, .riderStops)])
    let workout = run.engine.session.workout
    let replayed = RideEngine(
      replaying: run.inputs, from: RideSession(workout: workout, startDate: .distantPast))
    #expect(replayed.powerMatch == run.engine.powerMatch)
    #expect(replayed.trainerCommand == run.engine.trainerCommand)
  }

  @Test func learnsNothingWhilePaused() {
    var engine = RideEngine(
      session: RideSession(
        workout: Workout(name: "Steady", steps: [.init(duration: 600, targetPower: 200)]),
        startDate: .distantPast))
    engine.apply(.begin(trainerConnected: true))
    engine.apply(.togglePause)
    for _ in 0..<60 {
      engine.apply(
        .tick(
          seconds: 1,
          reading: TrainerReading(
            power: 190, powerMatch: PowerMatchReading(meter: 190, trainer: 200)),
          trainerConnected: true))
    }
    #expect(engine.powerMatch.ratio == 1)
    #expect(engine.trainerCommand == .power(watts: 200))
  }
}
