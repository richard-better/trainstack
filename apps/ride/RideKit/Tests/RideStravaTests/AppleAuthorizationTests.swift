import Foundation
import Testing

@testable import RideStrava

struct AppleAuthorizationTests {
  @Test func sendsTheCodeWithTheSessionToken() async throws {
    let (client, transport, _) = client([Reply(status: 204, body: "")])
    try await client.keepAppleAuthorization(code: "c0de.apple-1", for: signedInSession)

    let request = try #require(await transport.requests.first)
    #expect(request.httpMethod == "POST")
    #expect(request.url?.absoluteString == "https://api.example.com/account/apple-authorization")
    #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer session-token")
    #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
    #expect(try body(of: request) as? [String: String] == ["authorization_code": "c0de.apple-1"])
  }

  @Test(arguments: [
    (400, #"{"error":"invalid_request"}"#, AppleAuthorizationError.invalidRequest),
    (400, #"{"error":"invalid_code"}"#, .invalidCode),
    (403, #"{"error":"apple_account_required"}"#, .appleAccountRequired),
    (409, #"{"error":"another_apple_id"}"#, .anotherAppleID),
    (502, #"{"error":"apple_unavailable"}"#, .appleUnavailable),
    (503, #"{"error":"apple_not_configured"}"#, .appleNotConfigured),
  ])
  func tellsWhyTheServerDidNotKeepTheCode(
    status: Int, answer: String, error: AppleAuthorizationError
  ) async {
    let (client, _, store) = client([json(answer, status: status)])
    await #expect(throws: error) {
      try await client.keepAppleAuthorization(code: "c", for: signedInSession)
    }
    #expect(await store.load() == signedInSession)
  }

  @Test func reportsARefusedSessionWithoutSigningOut() async {
    let (client, _, store) = client([json(#"{"error":"unauthorized"}"#, status: 401)])
    await #expect(throws: StravaError.signedOut) {
      try await client.keepAppleAuthorization(code: "c", for: signedInSession)
    }
    #expect(await store.load() == signedInSession)
  }

  @Test func reportsAnAnswerItDoesNotKnowAsUnavailable() async {
    let (client, _, _) = client([json("{}", status: 500)])
    await #expect(throws: StravaError.unavailable) {
      try await client.keepAppleAuthorization(code: "c", for: signedInSession)
    }
  }

  @Test func sendsNothingWhenSignedOut() async {
    let (client, transport, _) = client([], signedIn: false)
    await #expect(throws: StravaError.signedOut) {
      try await client.keepAppleAuthorization(code: "c", for: signedInSession)
    }
    #expect(await transport.requests.isEmpty)
  }

  @Test func sendsTheCodeOnlyForTheSessionItCameWith() async throws {
    let (client, transport, _) = client(
      [Reply(body: #"{"user":{"id":"b"}}"#, headers: ["set-auth-token": "b-token"])])
    try await client.signInWithApple(identityToken: "jwt", nonce: "n", fullName: nil)
    await #expect(throws: StravaError.signedOut) {
      try await client.keepAppleAuthorization(code: "a-code", for: signedInSession)
    }
    #expect(await transport.requests.count == 1)
  }
}
