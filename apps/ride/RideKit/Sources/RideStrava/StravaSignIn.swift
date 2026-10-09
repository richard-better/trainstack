import CryptoKit
import Foundation
import Security

/// One sign-in to Strava. The server holds the app's secret: the app opens the server's
/// authorize address in a web authentication session, and the server sends a ticket back to the
/// `trainstackride` scheme once the rider has agreed. Any app can claim that scheme, so the ticket
/// is no use without the verifier, which never leaves this value.
public struct StravaSignIn: Sendable {
  public static let server = URL(string: "https://api.trainstackhq.com")!
  public static let callbackScheme = "trainstackride"

  /// Comes back unchanged, so a redirect from some other sign-in is ignored.
  public let state: String
  /// Kept secret; the server is shown only its SHA-256 until the ticket is redeemed.
  public let verifier: String

  public init() {
    state = Self.randomString(byteCount: 24)
    verifier = Self.randomString(byteCount: 48)
  }

  init(state: String, verifier: String) {
    self.state = state
    self.verifier = verifier
  }

  var challenge: String {
    Self.base64URL(Data(SHA256.hash(data: Data(verifier.utf8))))
  }

  /// Where to send the rider to sign in.
  public func authorizeURL(server: URL = Self.server) -> URL {
    var components = URLComponents(
      url: server.appending(path: "strava/authorize"), resolvingAgainstBaseURL: false)!
    components.queryItems = [
      URLQueryItem(name: "state", value: state),
      URLQueryItem(name: "code_challenge", value: challenge),
    ]
    return components.url!
  }

  /// The ticket the server handed back to the app, if it is for this sign-in.
  public func ticket(from callback: URL) throws -> String {
    let items = URLComponents(url: callback, resolvingAgainstBaseURL: false)?.queryItems ?? []
    func value(_ name: String) -> String? { items.first { $0.name == name }?.value }

    guard value("state") == state else { throw StravaError.stateMismatch }
    if let error = value("error") {
      switch error {
      case "access_denied": throw StravaError.denied
      case "insufficient_scope": throw StravaError.missingPermission
      case "strava_not_configured": throw StravaError.notConfigured
      default: throw StravaError.signInFailed
      }
    }
    guard let ticket = value("ticket"), !ticket.isEmpty else { throw StravaError.signInFailed }
    return ticket
  }

  private static func randomString(byteCount: Int) -> String {
    var bytes = [UInt8](repeating: 0, count: byteCount)
    if SecRandomCopyBytes(kSecRandomDefault, byteCount, &bytes) != errSecSuccess {
      bytes = (0..<byteCount).map { _ in UInt8.random(in: .min ... .max) }
    }
    return base64URL(Data(bytes))
  }

  private static func base64URL(_ data: Data) -> String {
    data.base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }
}
