import Testing

@testable import RideUI

struct WorkoutChartScaleTests {
  @Test(arguments: [
    (140.0, 50, 3), (380, 100, 4), (420, 100, 5), (560, 200, 3), (45, 10, 5),
  ])
  func fitsPowerInAtMostFiveRoundSteps(peak: Double, step: Int, steps: Int) {
    let scale = WorkoutChartScale(peakPower: peak, heartRates: 100...180)
    #expect(scale.powerStep == step)
    #expect(scale.steps == steps)
    #expect(scale.powerMaximum >= peak)
  }

  @Test func putsRoundHeartRatesOnThePowerGridlines() {
    let scale = WorkoutChartScale(peakPower: 420, heartRates: 96...171)
    #expect(scale.gridlines == [0, 100, 200, 300, 400, 500])
    #expect(scale.gridlines.map(scale.heartRate(at:)) == [80, 100, 120, 140, 160, 180])
  }

  @Test(arguments: [100...180, 96...171, 136...178, 60...200, 40...220, 0...250])
  func spansTheHeartRatesFromAMultipleOfTheStep(heartRates: ClosedRange<Int>) {
    for peak in [140.0, 380, 560] {
      let scale = WorkoutChartScale(peakPower: peak, heartRates: heartRates)
      #expect(scale.heartRateFloor % scale.heartRateStep == 0)
      #expect(scale.position(ofHeartRate: Double(heartRates.lowerBound)) >= 0)
      #expect(scale.position(ofHeartRate: Double(heartRates.upperBound)) <= scale.powerMaximum)
    }
  }

  @Test func readsBackTheHeartRateItPlaces() {
    let scale = WorkoutChartScale(peakPower: 380, heartRates: 120...175)
    for bpm in [120.0, 133, 150.5, 175] {
      #expect(abs(scale.heartRate(at: scale.position(ofHeartRate: bpm)) - bpm) < 1e-9)
    }
  }

  @Test func fitsRecordedHeartRateWithTheZoneLimits() {
    let range = WorkoutChartScale.heartRateRange(recorded: [92, 150], zoneLimits: [138, 178])
    #expect(range == 92...178)
  }

  @Test func fallsBackToATypicalRangeWithoutZones() {
    #expect(WorkoutChartScale.heartRateRange(recorded: [], zoneLimits: []) == 100...180)
    #expect(WorkoutChartScale.heartRateRange(recorded: [195], zoneLimits: []) == 100...195)
  }
}
