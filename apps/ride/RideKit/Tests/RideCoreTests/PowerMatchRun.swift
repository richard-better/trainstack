import Foundation
import RideData

@testable import RideCore

struct PowerMatchRun {
  enum Fault: Equatable {
    case meterSilent
    case meterReadsZero
    case riderStops
  }

  struct Second: Equatable {
    var target: Int?
    var commanded: Int?
    var meter: Int?
    var trueMeter: Double
    var ratio: Double
  }

  struct Interval: Equatable {
    var start: Int
    var end: Int
    var target: Int
    var previousTarget: Int?
  }

  let seconds: [Second]
  let intervals: [Interval]
  let engine: RideEngine
  let inputs: [RideInput]

  init(
    _ steps: [(seconds: Int, watts: Int)], meterFactor: Double, matching: Bool = true,
    faults: [(Range<Int>, Fault)] = []
  ) {
    let workout = Workout(
      name: "Steps",
      steps: steps.map { Workout.Step(duration: TimeInterval($0.seconds), targetPower: $0.watts) })
    var engine = RideEngine(session: RideSession(workout: workout, startDate: .distantPast))
    var inputs: [RideInput] = [.begin(trainerConnected: true)]
    engine.apply(inputs[0])
    var rig = ErgRig(meterFactor: meterFactor)
    var seconds: [Second] = []
    let length = steps.map(\.seconds).reduce(0, +)
    for second in 0..<length {
      let fault = faults.first { $0.0.contains(second) }?.1
      let target = engine.session.targetPower
      let commanded: Int? =
        if case .power(let watts) = engine.trainerCommand { watts } else { nil }
      let measured = rig.second(commanded: commanded, pedalling: fault != .riderStops)
      var meter: Int? = measured.meter
      switch fault {
      case .meterSilent: meter = nil
      case .meterReadsZero: meter = 0
      case .riderStops, nil: break
      }
      let reading = TrainerReading(
        power: meter, cadence: fault == .riderStops ? 0 : 90,
        powerMatch: matching ? PowerMatchReading(meter: meter, trainer: measured.trainer) : nil)
      let input = RideInput.tick(seconds: 1, reading: reading, trainerConnected: true)
      inputs.append(input)
      engine.apply(input)
      seconds.append(
        Second(
          target: target, commanded: commanded, meter: meter,
          trueMeter: measured.hub * meterFactor, ratio: engine.powerMatch.ratio))
    }
    var intervals: [Interval] = []
    var start = 0
    for step in steps {
      intervals.append(
        Interval(
          start: start, end: start + step.seconds, target: step.watts,
          previousTarget: intervals.last?.target))
      start += step.seconds
    }
    self.seconds = seconds
    self.intervals = intervals
    self.engine = engine
    self.inputs = inputs
  }

  func overshootShareOfStep(in interval: Interval) -> Double {
    guard let index = intervals.firstIndex(of: interval), index > 0 else { return 0 }
    let settled = steadyMean(in: interval)
    let step = settled - steadyMean(in: intervals[index - 1])
    guard abs(step) > 0 else { return 0 }
    let beyond = seconds[interval.start..<interval.end].map {
      ($0.trueMeter - settled) * (step > 0 ? 1 : -1)
    }
    return max(0, beyond.max() ?? 0) / abs(step)
  }

  func steadyMean(in interval: Interval, overLast span: Int = 30) -> Double {
    let tail = seconds[(interval.end - span)..<interval.end]
    return tail.map(\.trueMeter).reduce(0, +) / Double(tail.count)
  }

  func settlingSeconds(in interval: Interval, within share: Double) -> Int? {
    let band = share * Double(interval.target)
    let ridden = Array(seconds[interval.start..<interval.end])
    guard
      let lastOutside = ridden.lastIndex(where: {
        abs($0.trueMeter - Double(interval.target)) > band
      })
    else { return 0 }
    return lastOutside + 1 < ridden.count ? lastOutside + 1 : nil
  }

  func steadyError(in interval: Interval) -> Double {
    steadyMean(in: interval) / Double(interval.target) - 1
  }

  func commandSwing(in interval: Interval, after settle: Int) -> Int {
    let commands = seconds[(interval.start + settle)..<interval.end].compactMap(\.commanded)
    return (commands.max() ?? 0) - (commands.min() ?? 0)
  }
}
