import CryptoKit
import Foundation
import Security

/// The nonce for one Sign in with Apple: Apple is given its SHA-256 and puts it in the identity
/// token, and the server is given the original, so a token cannot be replayed from elsewhere.
struct AppleSignInNonce {
  let raw: String

  init() {
    var bytes = [UInt8](repeating: 0, count: 32)
    if SecRandomCopyBytes(kSecRandomDefault, bytes.count, &bytes) != errSecSuccess {
      bytes = bytes.map { _ in UInt8.random(in: .min ... .max) }
    }
    raw = bytes.map { String(format: "%02x", $0) }.joined()
  }

  init(raw: String) {
    self.raw = raw
  }

  /// What goes to Apple.
  var hashed: String {
    SHA256.hash(data: Data(raw.utf8)).map { String(format: "%02x", $0) }.joined()
  }
}
