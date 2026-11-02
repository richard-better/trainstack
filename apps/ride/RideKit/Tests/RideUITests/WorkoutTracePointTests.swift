import Foundation
import Testing

@testable import RideData
@testable import RideUI

struct WorkoutTracePointTests {
  private func samples(at positions: [Int]) -> [RideSession.LiveSample] {
    positions.map {
      RideSession.LiveSample(
        position: TimeInterval($0),
        sample: RideRecording.Sample(elapsed: TimeInterval($0), power: 200, heartRate: 140))
    }
  }

  @Test func keepsEverySampleOfAShortRide() {
    let trace = WorkoutTracePoint.trace(of: samples(at: Array(0..<300)))
    #expect(trace.map(\.position) == (0..<300).map(TimeInterval.init))
  }

  @Test func aSkipStartsANewRunSoTheLinesLeaveAGapRatherThanAJump() {
    let trace = WorkoutTracePoint.trace(of: samples(at: [0, 1, 2, 3, 60, 61, 62]))
    #expect(trace.map(\.unbrokenRun) == [0, 0, 0, 0, 1, 1, 1])
  }

  @Test func thinsALongRideSoTheChartStaysQuickToRedrawEverySecond() {
    let trace = WorkoutTracePoint.trace(of: samples(at: Array(0..<3600)))
    #expect(trace.count == WorkoutTracePoint.mostPointsBeforeThinning)
    #expect(Set(trace.map(\.unbrokenRun)) == [0])
  }
}
