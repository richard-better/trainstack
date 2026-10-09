import Foundation
import Testing

@testable import RideStrava

struct StravaSignInTests {
  /// The example verifier and challenge from RFC 7636.
  private let signIn = StravaSignIn(
    state: "state-from-the-app-0123456789abcd",
    verifier: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")

  @Test func sendsTheRiderToTheServerWithAChallengeInsteadOfTheVerifier() throws {
    let url = signIn.authorizeURL(server: URL(string: "https://api.example.com")!)
    let components = try #require(URLComponents(url: url, resolvingAgainstBaseURL: false))
    #expect(components.host == "api.example.com")
    #expect(components.path == "/strava/authorize")
    let items = Dictionary(
      uniqueKeysWithValues: (components.queryItems ?? []).map { ($0.name, $0.value) })
    #expect(items["state"] == "state-from-the-app-0123456789abcd")
    #expect(items["code_challenge"] == "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM")
    #expect(!url.absoluteString.contains(signIn.verifier))
  }

  @Test func makesAFreshStateAndVerifierEveryTimeThatTheServerWillAccept() {
    let first = StravaSignIn()
    let second = StravaSignIn()
    #expect(first.state != second.state)
    #expect(first.verifier != second.verifier)
    // The server takes a 16 to 64 character state and a 43 to 128 character verifier.
    #expect((16...64).contains(first.state.count))
    #expect((43...128).contains(first.verifier.count))
    let allowed = CharacterSet(
      charactersIn: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")
    #expect(first.state.unicodeScalars.allSatisfy(allowed.contains))
    #expect(first.verifier.unicodeScalars.allSatisfy(allowed.contains))
    #expect(first.challenge.count == 43)
  }

  @Test func takesTheTicketFromTheRedirect() throws {
    let url = URL(
      string: "trainstackride://strava?state=state-from-the-app-0123456789abcd&ticket=abc123")!
    #expect(try signIn.ticket(from: url) == "abc123")
  }

  @Test func ignoresARedirectFromAnotherSignIn() {
    let url = URL(
      string: "trainstackride://strava?state=someone-elses-state-0123456789&ticket=abc123")!
    #expect(throws: StravaError.stateMismatch) { try signIn.ticket(from: url) }
    #expect(throws: StravaError.stateMismatch) {
      try signIn.ticket(from: URL(string: "trainstackride://strava?ticket=abc123")!)
    }
  }

  @Test func explainsWhyASignInDidNotFinish() {
    func failure(_ query: String) -> StravaError? {
      let url = URL(
        string: "trainstackride://strava?state=state-from-the-app-0123456789abcd&\(query)")!
      do {
        _ = try signIn.ticket(from: url)
        return nil
      } catch {
        return error as? StravaError
      }
    }
    #expect(failure("error=access_denied") == .denied)
    #expect(failure("error=insufficient_scope") == .missingPermission)
    #expect(failure("error=strava_not_configured") == .notConfigured)
    #expect(failure("error=exchange_failed") == .signInFailed)
    #expect(failure("") == .signInFailed)
  }
}
