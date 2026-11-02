import Foundation
import Testing

@testable import RideBluetooth

struct RideClaimChallengeTests {
  private let claim = RideClaim(secret: RideClaim.secret())

  @Test func acceptsEachSignedChallengeOnlyOnce() {
    var challenge = RideClaimChallenge()
    let signature = claim.sign(challenge.value)
    let first = challenge.accept(signature, from: claim)
    let second = challenge.accept(signature, from: claim)
    #expect(first)
    #expect(!second)
  }

  @Test func refusesASignatureFromAnotherSecret() {
    var challenge = RideClaimChallenge()
    let signature = RideClaim(secret: RideClaim.secret()).sign(challenge.value)
    let accepted = challenge.accept(signature, from: claim)
    #expect(!accepted)
  }

  @Test func refusesASignatureOfTheChallengeBeforeItWasRenewed() {
    var challenge = RideClaimChallenge()
    let signature = claim.sign(challenge.value)
    challenge.renew()
    let accepted = challenge.accept(signature, from: claim)
    #expect(!accepted)
  }
}
