import RideData
import Testing

@testable import RideUI

struct WorkoutTargetShadeTests {
  /// The second interval of a workout, from 600 to 900 seconds at `power` watts.
  private func interval(power: Int = 190) -> RideSession.Interval {
    let workout = Workout(
      name: "Three steps",
      steps: [
        .init(duration: 600, targetPower: 120), .init(duration: 300, targetPower: power),
        .init(duration: 300, targetPower: 120),
      ])
    return RideSession(workout: workout).intervals[1]
  }

  @Test(arguments: [
    (300.0, WorkoutTargetShade.Stage.upcoming), (600, .current), (899, .current), (900, .ridden),
    (1200, .ridden),
  ])
  func stagesTheIntervalByWhereTheRiderIs(position: Double, stage: WorkoutTargetShade.Stage) {
    #expect(WorkoutTargetShade(interval: interval(), position: position, ftp: 200).stage == stage)
  }

  @Test(arguments: [
    (100, PowerZone.recovery), (130, .endurance), (160, .tempo), (190, .threshold),
    (220, .vo2Max), (300, .anaerobic),
  ])
  func colorsTheTargetByItsPowerZone(power: Int, zone: PowerZone) {
    #expect(
      WorkoutTargetShade(interval: interval(power: power), position: 0, ftp: 200).zone == zone)
  }

  @Test(arguments: [nil, 0])
  func staysGreyWithoutAnFTP(ftp: Int?) {
    #expect(WorkoutTargetShade(interval: interval(), position: 0, ftp: ftp).zone == nil)
  }

  @Test(arguments: [200, nil])
  func shadesTheCurrentIntervalStrongestAndThoseToComeFaintest(ftp: Int?) {
    let interval = interval()
    let opacity = { (position: Double) in
      WorkoutTargetShade(interval: interval, position: position, ftp: ftp).opacity
    }
    #expect(opacity(300) < opacity(1200))
    #expect(opacity(1200) < opacity(700))
  }
}
