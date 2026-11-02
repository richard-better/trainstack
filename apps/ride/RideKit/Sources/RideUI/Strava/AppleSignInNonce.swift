import CryptoKit
import Foundation
import Security

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

  var sha256ForApple: String {
    SHA256.hash(data: Data(raw.utf8)).map { String(format: "%02x", $0) }.joined()
  }
}
