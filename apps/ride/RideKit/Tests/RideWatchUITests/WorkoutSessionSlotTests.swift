import Testing

@testable import RideWatchUI

struct WorkoutSessionSlotTests {
  private final class Session {}

  @Test func ownsTheSessionItTook() {
    var slot = WorkoutSessionSlot<Session>()
    let session = Session()
    let took = slot.take(session)
    #expect(took)
    #expect(slot.holds(session))
  }

  @Test func ignoresCallbacksFromASessionThatHasEnded() {
    var slot = WorkoutSessionSlot<Session>()
    let ended = Session()
    _ = slot.take(ended)
    slot.empty()
    #expect(!slot.holds(ended))
    let next = Session()
    _ = slot.take(next)
    #expect(!slot.holds(ended))
  }

  @Test func ignoresCallbacksFromASessionThatIsGone() {
    var slot = WorkoutSessionSlot<Session>()
    _ = slot.take(Session())
    #expect(!slot.holds(nil))
  }

  @Test func recoveryDoesNotReplaceASessionThatStartedWhileItWasRecovering() {
    var slot = WorkoutSessionSlot<Session>()
    let started = Session()
    _ = slot.take(started)
    let recovered = Session()
    let tookRecovered = slot.take(recovered)
    #expect(!tookRecovered)
    #expect(slot.holds(started))
    #expect(!slot.holds(recovered))
  }
}
