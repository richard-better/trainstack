import Foundation

struct RideClaimChallenge {
  private(set) var value = RideClaim.challenge()

  mutating func renew() {
    value = RideClaim.challenge()
  }

  mutating func accept(_ signature: Data, from claim: RideClaim) -> Bool {
    guard claim.verifies(signature, for: value) else { return false }
    renew()
    return true
  }
}
