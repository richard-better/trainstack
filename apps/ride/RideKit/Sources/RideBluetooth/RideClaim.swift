import CryptoKit
import Foundation

/// Proof that Ride on a Mac recording a ride belongs to the same rider as the relaying iPhone,
/// so a Mac in range only tells the rider's own watch to leave the ride to it.
///
/// Both devices hold a random secret that only reaches devices signed in to the rider's Apple
/// Account, through their private iCloud database. The iPhone offers a fresh challenge, and
/// accepts a claim only with the challenge signed with that secret, which a Mac signed in to
/// another account, or anything else in range, cannot make.
public struct RideClaim: Sendable {
  private let key: SymmetricKey

  public init(secret: Data) {
    key = SymmetricKey(data: secret)
  }

  /// A new secret, for the first of the rider's devices to sync.
  public static func secret() -> Data {
    SymmetricKey(size: .bits256).withUnsafeBytes { Data($0) }
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
