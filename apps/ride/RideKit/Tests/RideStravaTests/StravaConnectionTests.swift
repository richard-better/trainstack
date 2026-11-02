import CryptoKit
import Foundation
import Testing

@testable import RideStrava

struct StravaConnectionTests {
  @Test func readsWhetherStravaIsConnected() async throws {
    let (client, transport, _) = client([
      json(#"{"connected":true,"athleteName":"Ada Rider"}"#), json(#"{"connected":false}"#),
    ])
    #expect(
      try await client.stravaStatus() == StravaStatus(isConnected: true, athleteName: "Ada Rider"))
    #expect(try await client.stravaStatus() == StravaStatus(isConnected: false))
    let request = try #require(await transport.requests.first)
    #expect(request.url?.absoluteString == "https://api.example.com/strava")
    #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer session-token")
  }

  @Test func startsConnectingWithAChallengeAndKeepsTheVerifier() async throws {
    let (client, transport, _) = client([
      json(#"{"url":"https://www.strava.com/oauth/authorize?client_id=1"}"#),
      json(#"{"connected":true,"athleteName":"Ada Rider"}"#),
    ])
    let attempt = try await client.startStravaConnection()
    #expect(attempt.authorizationURL.host == "www.strava.com")

    let start = try #require(await transport.requests.first)
    #expect(start.httpMethod == "POST")
    #expect(start.url?.path == "/strava/connect")
    let challenge = try #require(body(of: start)["code_challenge"] as? String)
    #expect(challenge.count == 43)
    #expect(!challenge.contains(attempt.codeVerifier))

    let status = try await client.finishStravaConnection(
      attempt, callback: URL(string: "trainstackride://strava?connected=1")!)
    #expect(status == StravaStatus(isConnected: true, athleteName: "Ada Rider"))
    let finish = try #require(await transport.requests.last)
    #expect(finish.url?.path == "/strava/connect/complete")
    let verifier = try #require(body(of: finish)["code_verifier"] as? String)
    #expect(verifier == attempt.codeVerifier)
    #expect((43...128).contains(verifier.count))
    let sha256OfVerifier = Data(SHA256.hash(data: Data(verifier.utf8))).base64EncodedString()
      .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
    #expect(challenge == sha256OfVerifier)
  }

  @Test func usesAFreshVerifierForEveryAttempt() async throws {
    let reply = json(#"{"url":"https://www.strava.com/oauth/authorize"}"#)
    let (client, _, _) = client([reply, reply])
    let first = try await client.startStravaConnection()
    let second = try await client.startStravaConnection()
    #expect(first.codeVerifier != second.codeVerifier)
  }

  @Test func doesNotCollectAConnectionTheWebSessionDidNotEndWell() async throws {
    let (client, transport, _) = client([
      json(#"{"url":"https://www.strava.com/oauth/authorize"}"#)
    ])
    let attempt = try await client.startStravaConnection()
    await #expect(throws: StravaError.cancelled) {
      try await client.finishStravaConnection(
        attempt, callback: URL(string: "trainstackride://strava?error=access_denied")!)
    }
    #expect(await transport.requests.count == 1)
  }

  @Test func reportsAConnectionTheServerWillNotCollect() async throws {
    let (client, _, _) = client([
      json(#"{"url":"https://www.strava.com/oauth/authorize"}"#),
      json(#"{"error":"invalid_link"}"#, status: 400),
    ])
    let attempt = try await client.startStravaConnection()
    await #expect(throws: StravaError.connectFailed) {
      try await client.finishStravaConnection(
        attempt, callback: URL(string: "trainstackride://strava?connected=1")!)
    }
  }

  @Test func explainsWhyStravaCouldNotBeConnected() async throws {
    let (notApple, _, _) = client([json(#"{"error":"apple_account_required"}"#, status: 403)])
    await #expect(throws: StravaError.appleAccountRequired) {
      try await notApple.startStravaConnection()
    }

    let (taken, _, _) = client([
      json(#"{"url":"https://www.strava.com/oauth/authorize"}"#),
      json(#"{"error":"athlete_in_use"}"#, status: 409),
    ])
    let attempt = try await taken.startStravaConnection()
    await #expect(throws: StravaError.athleteInUse) {
      try await taken.finishStravaConnection(
        attempt, callback: URL(string: "trainstackride://strava?connected=1")!)
    }
  }

  @Test func readsHowConnectingStravaEnded() throws {
    try TrainStackClient.checkConnectCallback(URL(string: "trainstackride://strava?connected=1")!)
    func failure(_ query: String) -> StravaError? {
      do {
        try TrainStackClient.checkConnectCallback(URL(string: "trainstackride://strava?\(query)")!)
        return nil
      } catch {
        return error as? StravaError
      }
    }
    #expect(failure("error=access_denied") == .cancelled)
    #expect(failure("error=insufficient_scope") == .missingPermission)
    #expect(failure("error=strava_not_configured") == .notConfigured)
    #expect(failure("error=exchange_failed") == .connectFailed)
    #expect(failure("") == .connectFailed)
  }

  @Test func disconnectsStrava() async throws {
    let (client, transport, _) = client([Reply(status: 204, body: "")])
    try await client.disconnectStrava()
    let request = try #require(await transport.requests.first)
    #expect(request.httpMethod == "DELETE")
    #expect(request.url?.path == "/strava")
  }

  @Test func forgetsASessionTheServerNoLongerAccepts() async {
    let (client, _, store) = client([json(#"{"error":"unauthorized"}"#, status: 401)])
    await #expect(throws: StravaError.signedOut) { try await client.stravaStatus() }
    #expect(await store.load() == nil)
    #expect(await !client.isSignedIn)
  }

  @Test func needsAnAccountBeforeAskingAnything() async {
    let (client, transport, _) = client([], signedIn: false)
    await #expect(throws: StravaError.signedOut) { try await client.stravaStatus() }
    await #expect(throws: StravaError.signedOut) {
      try await client.upload(Data([1]), name: "Ride", fileName: "ride.fit")
    }
    #expect(await transport.requests.isEmpty)
  }
}
