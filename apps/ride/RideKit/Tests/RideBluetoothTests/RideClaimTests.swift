import Foundation
import Testing

@testable import RideBluetooth

struct RideClaimTests {
  @Test func acceptsAClaimFromTheSameAccount() {
    let challenge = RideClaim.challenge()
    let signature = RideClaim(accountRecordName: "_rider").sign(challenge)
    #expect(RideClaim(accountRecordName: "_rider").verifies(signature, for: challenge))
  }

  @Test func refusesAClaimFromAnotherAccount() {
    let challenge = RideClaim.challenge()
    let signature = RideClaim(accountRecordName: "_someone-else").sign(challenge)
    #expect(!RideClaim(accountRecordName: "_rider").verifies(signature, for: challenge))
  }

  @Test func refusesAClaimForAnEarlierChallenge() {
    let claim = RideClaim(accountRecordName: "_rider")
    let earlier = RideClaim.challenge()
    #expect(!claim.verifies(claim.sign(earlier), for: RideClaim.challenge()))
    #expect(!claim.verifies(Data(), for: earlier))
  }
}
