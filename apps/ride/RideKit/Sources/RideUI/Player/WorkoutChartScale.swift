import Foundation

struct WorkoutChartScale: Equatable {
  let powerStep: Int
  let steps: Int
  let heartRateFloor: Int
  let heartRateStep: Int

  init(peakPower: Double, heartRates: ClosedRange<Int>) {
    let powerStep =
      Self.powerSteps.first { (peakPower / Double($0)).rounded(.up) <= Self.mostPowerSteps }
      ?? Int((peakPower / Self.mostPowerSteps / 1000).rounded(.up)) * 1000
    let steps = max(1, Int((peakPower / Double(powerStep)).rounded(.up)))
    self.powerStep = powerStep
    self.steps = steps
    let heartRateStep = Self.heartRateStep(spanning: heartRates, in: steps)
    self.heartRateStep = heartRateStep
    heartRateFloor = heartRates.lowerBound / heartRateStep * heartRateStep
  }

  static func heartRateRange(recorded: [Int], zoneLimits: [Int]) -> ClosedRange<Int> {
    let reference = zoneLimits.isEmpty ? [100, 180] : zoneLimits
    let all = recorded + reference
    return max(0, all.min() ?? 0)...(all.max() ?? 0)
  }

  var powerMaximum: Double { Double(steps * powerStep) }

  var gridlines: [Double] { (0...steps).map { Double($0 * powerStep) } }

  func shows(watts: Double) -> Bool { watts > 0 && watts <= powerMaximum }

  func watts(atHeartRate bpm: Double) -> Double {
    (bpm - Double(heartRateFloor)) / Double(heartRateStep) * Double(powerStep)
  }

  func heartRate(at watts: Double) -> Double {
    Double(heartRateFloor) + watts / Double(powerStep) * Double(heartRateStep)
  }

  private static func heartRateStep(spanning range: ClosedRange<Int>, in steps: Int) -> Int {
    func spans(_ step: Int) -> Bool {
      range.lowerBound / step * step + steps * step >= range.upperBound
    }
    return heartRateSteps.first(where: spans) ?? sequence(first: 100) { $0 + 50 }.first(
      where: spans)!
  }

  private static let mostPowerSteps = 5.0
  private static let powerSteps = [10, 20, 25, 50, 100, 200, 250, 500, 1000]
  private static let heartRateSteps = [5, 10, 20, 25, 30, 40, 50]
}
