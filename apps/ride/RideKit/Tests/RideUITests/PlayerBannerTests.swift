import Foundation
import RideData
import Testing

@testable import RideUI

struct PlayerBannerTests {
  private let workout = Workout(
    name: "Banner",
    steps: [
      .init(
        duration: 60, target: .power(.constant(150)),
        cues: [PlannedCue(at: 5, text: "Settle in", shownFor: 20)]),
      .init(duration: 300, target: .power(.constant(250)), name: "Threshold block"),
      .init(duration: 0, target: nil, untilLap: UntilLap()),
    ])

  private func session(at seconds: Int) -> RideSession {
    var session = RideSession(workout: workout)
    for _ in 0..<seconds { session.advance(by: 1, reading: .init(power: 150)) }
    return session
  }

  private func shown(at seconds: Int) -> [PlayerBanner] {
    PlayerBanner.shown(in: session(at: seconds), ftp: 250)
  }

  @Test func showsACueForItsShownForTime() {
    #expect(shown(at: 4).isEmpty)
    #expect(shown(at: 5).map(\.text) == ["Settle in"])
    #expect(shown(at: 24).map(\.kind) == [.cue])
    #expect(shown(at: 25).isEmpty)
  }

  @Test func aCueStillShowingDoesNotHoldBackTheNextStep() {
    let short = Workout(
      name: "Short",
      steps: [
        .init(
          duration: 15, target: .power(.constant(150)), cues: [PlannedCue(at: 0, text: "Easy")]),
        .init(duration: 15, target: .power(.constant(250))),
      ])
    var session = RideSession(workout: short)
    for _ in 0..<6 { session.advance(by: 1, reading: .init(power: 150)) }
    #expect(PlayerBanner.shown(in: session, ftp: 250).map(\.kind) == [.cue, .upcoming])
  }

  @Test func announcesTheNextStepByItsNameAndTargetAsItApproaches() {
    #expect(shown(at: 49).isEmpty)
    let banner = shown(at: 50).first
    #expect(banner?.kind == .upcoming)
    #expect(banner?.text == "Next: Threshold block · 250 W · for 5:00")
  }

  @Test func announcesTheNextPowerTargetInEveryModeAndAdjustsItOnlyInERG() {
    var slope = session(at: 50)
    slope.mode = .slope
    slope.adjust(by: 3)
    #expect(
      PlayerBanner.shown(in: slope, ftp: 250).first?.text
        == "Next: Threshold block · 250 W · for 5:00")
    var harder = session(at: 50)
    harder.adjust(by: 10)
    #expect(
      PlayerBanner.shown(in: harder, ftp: 250).first?.text
        == "Next: Threshold block · 275 W · for 5:00")
  }

  @Test func announcesANamedAllOutStepAsAMaxEffort() {
    var session = RideSession(
      workout: Workout(
        name: "Finish",
        steps: [
          .init(duration: 30, target: .power(.constant(150))),
          .init(duration: 20, target: .maxEffort, name: "Finish"),
        ]))
    for _ in 0..<20 { session.advance(by: 1, reading: .init(power: 150)) }
    #expect(
      PlayerBanner.shown(in: session, ftp: 250).first?.text
        == "Next: Finish · Max effort · for 0:20")
  }

  @Test func announcesALapButtonStepAsLastingUntilTheLap() {
    let banner = shown(at: 355).first
    #expect(banner?.text == "Next: Free ride · until you press lap")
  }

  @Test func saysWhenTheRiderMarkedALap() {
    var session = session(at: 20)
    session.markLap()
    #expect(
      PlayerBanner.shown(in: session, ftp: 250) == [
        .init(kind: .lap, text: "Lap 2"), .init(kind: .cue, text: "Settle in"),
      ])
  }
}
