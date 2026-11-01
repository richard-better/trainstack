import Foundation
import Testing

@testable import RideBluetooth

struct RideClaimTests {
  private let secret = RideClaim.secret()

  @Test func acceptsAClaimWithTheSameSecret() {
    let challenge = RideClaim.challenge()
    let signature = RideClaim(secret: secret).sign(challenge)
    #expect(RideClaim(secret: secret).verifies(signature, for: challenge))
  }

  @Test func refusesAClaimWithAnotherSecret() {
    let challenge = RideClaim.challenge()
    let signature = RideClaim(secret: RideClaim.secret()).sign(challenge)
    #expect(!RideClaim(secret: secret).verifies(signature, for: challenge))
  }

  @Test func makesADifferentSecretEachTime() {
    #expect(secret.count == 32)
    #expect(RideClaim.secret() != secret)
  }

  @Test func refusesAClaimForAnEarlierChallenge() {
    let claim = RideClaim(secret: secret)
    let earlier = RideClaim.challenge()
    #expect(!claim.verifies(claim.sign(earlier), for: RideClaim.challenge()))
    #expect(!claim.verifies(Data(), for: earlier))
  }
}
