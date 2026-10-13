import Foundation

/// The player chart's vertical scale. Power is drawn in watts, and heart rate is mapped onto
/// the same gridlines, so each gridline reads a round wattage on the leading axis and a round
/// heart rate on the trailing one.
struct WorkoutChartScale: Equatable {
  /// Watts between gridlines.
  let powerStep: Int
  /// Gridlines above the floor, so the top of the chart is `steps × powerStep` watts.
  let steps: Int
  /// The heart rate at the floor of the chart.
  let heartRateFloor: Int
  /// Beats per minute between gridlines.
  let heartRateStep: Int

  /// A scale that fits power up to `peakPower` in at most five steps, and heart rate over
  /// `heartRates` in as many steps.
  init(peakPower: Double, heartRates: ClosedRange<Int>) {
    let powerStep =
      Self.powerSteps.first { (peakPower / Double($0)).rounded(.up) <= 5 }
      ?? Int((peakPower / 5 / 1000).rounded(.up)) * 1000
    let steps = max(1, Int((peakPower / Double(powerStep)).rounded(.up)))
    self.powerStep = powerStep
    self.steps = steps
    let heartRateStep = Self.heartRateStep(spanning: heartRates, in: steps)
    self.heartRateStep = heartRateStep
    heartRateFloor = heartRates.lowerBound / heartRateStep * heartRateStep
  }

  /// The heart rates the chart should fit: those recorded so far, together with the rider's
  /// zone limits or else a typical riding range, so the scale settles early in the ride.
  static func heartRateRange(recorded: [Int], zoneLimits: [Int]) -> ClosedRange<Int> {
    let reference = zoneLimits.isEmpty ? [100, 180] : zoneLimits
    let all = recorded + reference
    return max(0, all.min() ?? 0)...(all.max() ?? 0)
  }

  var powerMaximum: Double { Double(steps * powerStep) }

  /// Where the gridlines are, in watts from the floor to the top.
  var gridlines: [Double] { (0...steps).map { Double($0 * powerStep) } }

  /// The height of `bpm` on the chart, in watts.
  func position(ofHeartRate bpm: Double) -> Double {
    (bpm - Double(heartRateFloor)) / Double(heartRateStep) * Double(powerStep)
  }

  /// The heart rate drawn at `watts` up the chart, the inverse of `position(ofHeartRate:)`.
  func heartRate(at watts: Double) -> Double {
    Double(heartRateFloor) + watts / Double(powerStep) * Double(heartRateStep)
  }

  /// The finest round step that spans `range` in `steps` from a multiple of itself.
  private static func heartRateStep(spanning range: ClosedRange<Int>, in steps: Int) -> Int {
    func spans(_ step: Int) -> Bool {
      range.lowerBound / step * step + steps * step >= range.upperBound
    }
    return heartRateSteps.first(where: spans) ?? sequence(first: 100) { $0 + 50 }.first(
      where: spans)!
  }

  private static let powerSteps = [10, 20, 25, 50, 100, 200, 250, 500, 1000]
  private static let heartRateSteps = [5, 10, 20, 25, 30, 40, 50]
}
