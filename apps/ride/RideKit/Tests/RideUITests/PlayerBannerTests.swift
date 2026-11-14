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

  @Test func showsACueForItsShownForTime() {
    #expect(PlayerBanner(session: session(at: 4), ftp: 250) == nil)
    #expect(PlayerBanner(session: session(at: 5), ftp: 250)?.text == "Settle in")
    #expect(PlayerBanner(session: session(at: 24), ftp: 250)?.kind == .cue)
    #expect(PlayerBanner(session: session(at: 25), ftp: 250) == nil)
  }

  @Test func announcesTheNextStepByItsNameAndTargetAsItApproaches() {
    #expect(PlayerBanner(session: session(at: 49), ftp: 250) == nil)
    let banner = PlayerBanner(session: session(at: 50), ftp: 250)
    #expect(banner?.kind == .upcoming)
    #expect(banner?.text == "Next: Threshold block · 250 W · for 5:00")
  }

  @Test func announcesALapButtonStepAsLastingUntilTheLap() {
    let banner = PlayerBanner(session: session(at: 355), ftp: 250)
    #expect(banner?.text == "Next: Free ride · until you press lap")
  }

  @Test func saysWhenTheRiderMarkedALap() {
    var session = session(at: 20)
    session.markLap()
    #expect(PlayerBanner(session: session, ftp: 250) == .init(kind: .lap, text: "Lap 2"))
  }
}
