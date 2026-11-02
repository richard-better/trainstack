import CryptoKit
import Foundation
import Testing

@testable import RideStrava

struct AppleWebSignInTests {
  private func challenge(of verifier: String) -> String {
    Data(SHA256.hash(data: Data(verifier.utf8))).base64EncodedString()
      .replacingOccurrences(of: "+", with: "-")
      .replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
  }

  @Test func opensTheHandoffWithTheChallengeOfAFreshVerifier() async throws {
    let (client, transport, _) = client([], signedIn: false)
    let attempt = await client.startAppleWebSignIn()
    let components = try #require(URLComponents(url: attempt.url, resolvingAgainstBaseURL: false))
    #expect(components.host == "api.example.com")
    #expect(components.path == "/api/auth/app-handoff/apple")
    #expect(
      components.queryItems == [
        URLQueryItem(name: "code_challenge", value: challenge(of: attempt.verifier))
      ])
    #expect(await client.startAppleWebSignIn().verifier != attempt.verifier)
    #expect(await transport.requests.isEmpty)
  }

  @Test func tradesTheCodeAndVerifierForASession() async throws {
    let (client, transport, store) = client(
      [json(#"{"token":"web-token","user":{"name":"Ada Rider"}}"#)], signedIn: false)
    let attempt = await client.startAppleWebSignIn()
    try await client.finishAppleWebSignIn(
      attempt, callback: URL(string: "trainstackride://signed-in?code=the-code")!)

    #expect(await client.isSignedIn)
    #expect(await store.load() == AccountSession(token: "web-token", name: "Ada Rider"))
    let request = try #require(await transport.requests.first)
    #expect(request.url?.absoluteString == "https://api.example.com/api/auth/app-handoff/token")
    #expect(request.httpMethod == "POST")
    #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
    let sent = try body(of: request)
    #expect(sent["code"] as? String == "the-code")
    #expect(sent["code_verifier"] as? String == attempt.verifier)
  }

  @Test func readsHowTheWebFlowEnded() throws {
    func code(_ query: String) throws -> String {
      try TrainStackClient.signInCode(from: URL(string: "trainstackride://signed-in?\(query)")!)
    }
    #expect(try code("code=abc") == "abc")
    #expect(throws: StravaError.cancelled) { try code("error=user_cancelled_authorize") }
    #expect(throws: StravaError.signInFailed) { try code("error=apple_web_not_configured") }
    #expect(throws: StravaError.signInFailed) { try code("code=abc&error=state_mismatch") }
    #expect(throws: StravaError.signInFailed) { try code("code=") }
    #expect(throws: StravaError.signInFailed) { try code("") }
  }

  @Test func asksNothingWhenTheWebFlowDidNotEndWell() async {
    let (client, transport, _) = client([], signedIn: false)
    let attempt = await client.startAppleWebSignIn()
    await #expect(throws: StravaError.signInFailed) {
      try await client.finishAppleWebSignIn(
        attempt, callback: URL(string: "trainstackride://signed-in?error=sign_in_failed")!)
    }
    #expect(await transport.requests.isEmpty)
    #expect(await !client.isSignedIn)
  }

  @Test func reportsACodeTheServerWillNotTrade() async {
    func failure(_ status: Int, _ body: String = "{}") async -> StravaError? {
      let (client, _, store) = client([json(body, status: status)], signedIn: false)
      let attempt = await client.startAppleWebSignIn()
      do {
        try await client.finishAppleWebSignIn(
          attempt, callback: URL(string: "trainstackride://signed-in?code=c")!)
        return nil
      } catch {
        #expect(await store.load() == nil)
        return error as? StravaError
      }
    }
    #expect(await failure(400, #"{"code":"INVALID_CODE"}"#) == .signInFailed)
    #expect(await failure(429) == .rateLimited)
    #expect(await failure(503) == .unavailable)
    #expect(await failure(200, #"{"user":{}}"#) == .signInFailed)
  }

  @Test func staysSignedOutWhenTheDeviceWillNotKeepTheSession() async {
    let web = TrainStackClient(
      server: URL(string: "https://api.example.com")!, store: SessionStoreThatWillNotKeepAnything(),
      transport: ScriptedTransport([json(#"{"token":"t"}"#)]))
    let attempt = await web.startAppleWebSignIn()
    await #expect(throws: StravaError.sessionNotKept) {
      try await web.finishAppleWebSignIn(
        attempt, callback: URL(string: "trainstackride://signed-in?code=c")!)
    }
    #expect(await !web.isSignedIn)
  }

  @Test func signsInNativelyOnlyWithTheEntitlement() {
    #expect(AppleSignIn.allowsNativeSignIn(["Default"]))
    #expect(!AppleSignIn.allowsNativeSignIn(nil))
    #expect(!AppleSignIn.allowsNativeSignIn([String]()))
    #expect(!AppleSignIn.allowsNativeSignIn(["Other"]))
    #expect(!AppleSignIn.allowsNativeSignIn("Default"))
  }
}
