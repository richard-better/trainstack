import CryptoKit
import Foundation

/// Proof that Ride on a Mac recording a ride belongs to the same rider as the relaying iPhone,
/// so a Mac in range only tells the rider's own watch to leave the ride to it.
///
/// Both devices hold a key derived from the rider's Apple Account. The iPhone offers a fresh
/// challenge each time it relays, and accepts a claim only with the challenge signed with that
/// key, which a Mac signed in to another account, or anything else in range, cannot make.
public struct RideClaim: Sendable {
  private let key: SymmetricKey

  /// The key for the account with the iCloud user record named `accountRecordName`.
  public init(accountRecordName: String) {
    key = SymmetricKey(data: SHA256.hash(data: Data("ride-claim:\(accountRecordName)".utf8)))
  }

  func sign(_ challenge: Data) -> Data {
    Data(HMAC<SHA256>.authenticationCode(for: challenge, using: key))
  }

  func verifies(_ signature: Data, for challenge: Data) -> Bool {
    HMAC<SHA256>.isValidAuthenticationCode(signature, authenticating: challenge, using: key)
  }

  static func challenge() -> Data {
    Data(SymmetricKey(size: .bits128).withUnsafeBytes { Array($0) })
  }
}
