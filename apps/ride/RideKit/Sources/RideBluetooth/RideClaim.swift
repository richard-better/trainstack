import CryptoKit
import Foundation

public struct RideClaim: Sendable {
  private let key: SymmetricKey

  public init(secret: Data) {
    key = SymmetricKey(data: secret)
  }

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
