import CryptoKit
import Foundation
import Synchronization
import Testing

@testable import RideStrava

/// Answers requests from a script and remembers them.
private actor FakeTransport: HTTPTransport {
  struct Reply {
    var status = 200
    var body = "{}"
    var headers: [String: String] = [:]
    var fails = false
  }

  private(set) var requests: [URLRequest] = []
  private var replies: [Reply]

  init(_ replies: [Reply]) {
    self.replies = replies
  }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    requests.append(request)
    let reply = replies.isEmpty ? Reply() : replies.removeFirst()
    if reply.fails { throw URLError(.notConnectedToInternet) }
    let response = HTTPURLResponse(
      url: request.url!, statusCode: reply.status, httpVersion: nil, headerFields: reply.headers)!
    return (Data(reply.body.utf8), response)
  }
}

private typealias Reply = FakeTransport.Reply

private let session = AccountSession(token: "session-token", name: "Ada Rider")

/// Counts the times the kept session is read.
private final class CountingSessionStore: SessionStore {
  private let kept: AccountSession?
  private let count = Mutex(0)

  init(_ kept: AccountSession?) { self.kept = kept }

  var reads: Int { count.withLock { $0 } }

  func load() async -> AccountSession? {
    count.withLock { $0 += 1 }
    return kept
  }

  func save(_ session: AccountSession?) {}
}

private func client(
  _ replies: [Reply], signedIn: Bool = true, pollLimit: Int = 5
) -> (TrainStackClient, FakeTransport, InMemorySessionStore) {
  let transport = FakeTransport(replies)
  let store = InMemorySessionStore(signedIn ? session : nil)
  let client = TrainStackClient(
    server: URL(string: "https://api.example.com")!, store: store, transport: transport,
    pollInterval: .zero, pollLimit: pollLimit)
  return (client, transport, store)
}

private func json(_ text: String, status: Int = 200) -> Reply {
  Reply(status: status, body: text)
}

private func body(of request: URLRequest) throws -> [String: Any] {
  let data = try #require(request.httpBody)
  let object = try JSONSerialization.jsonObject(with: data)
  return try #require(object as? [String: Any])
}

struct TrainStackAccountTests {
  @Test func signsInWithTheIdentityTokenAndKeepsTheSession() async throws {
    let (client, transport, store) = client(
      [
        Reply(
          body: #"{"token":"body-token","user":{"name":"Ada Rider"}}"#,
          headers: ["set-auth-token": "header-token"])
      ], signedIn: false)
    #expect(await !client.isSignedIn)
    try await client.signInWithApple(identityToken: "apple-jwt", nonce: "raw-nonce", fullName: nil)

    #expect(await client.isSignedIn)
    #expect(await client.accountName == "Ada Rider")
    #expect(await store.load() == AccountSession(token: "header-token", name: "Ada Rider"))
    let request = try #require(await transport.requests.first)
    #expect(request.url?.absoluteString == "https://api.example.com/api/auth/sign-in/social")
    #expect(request.value(forHTTPHeaderField: "Authorization") == nil)
    let sent = try body(of: request)
    #expect(sent["provider"] as? String == "apple")
    let idToken = try #require(sent["idToken"] as? [String: String])
    #expect(idToken == ["token": "apple-jwt", "nonce": "raw-nonce"])
  }

  @Test func givesTheAccountTheNameAppleSharesOnlyTheFirstTime() async throws {
    let (client, transport, store) = client(
      [
        Reply(body: #"{"user":{"name":""}}"#, headers: ["set-auth-token": "t"]),
        json("{}"),
      ], signedIn: false)
    try await client.signInWithApple(identityToken: "jwt", nonce: "n", fullName: "Ada Rider")

    #expect(await store.load()?.name == "Ada Rider")
    let requests = await transport.requests
    #expect(requests.count == 2)
    #expect(requests[1].url?.path == "/api/auth/update-user")
    #expect(requests[1].value(forHTTPHeaderField: "Authorization") == "Bearer t")
    #expect(try body(of: requests[1])["name"] as? String == "Ada Rider")
  }

  @Test func reportsASignInTheServerRefuses() async {
    let (rejected, _, store) = client(
      [json(#"{"code":"INVALID_TOKEN"}"#, status: 401)], signedIn: false)
    await #expect(throws: StravaError.signInFailed) {
      try await rejected.signInWithApple(identityToken: "x", nonce: "n", fullName: nil)
    }
    #expect(await store.load() == nil)

    let (down, _, _) = client([json("{}", status: 503)], signedIn: false)
    await #expect(throws: StravaError.unavailable) {
      try await down.signInWithApple(identityToken: "x", nonce: "n", fullName: nil)
    }
    let (noToken, _, _) = client([json("{}")], signedIn: false)
    await #expect(throws: StravaError.signInFailed) {
      try await noToken.signInWithApple(identityToken: "x", nonce: "n", fullName: nil)
    }
  }

  @Test func readsTheKeptSessionOnceWhenFirstNeeded() async {
    let store = CountingSessionStore(session)
    let client = TrainStackClient(store: store, transport: FakeTransport([]))
    #expect(store.reads == 0)
    async let signedIn = client.isSignedIn
    async let name = client.accountName
    #expect(await signedIn)
    #expect(await name == "Ada Rider")
    #expect(store.reads == 1)
  }

  @Test func keepsANewSignInOverTheSessionKeptBeforeIt() async throws {
    let store = CountingSessionStore(AccountSession(token: "old", name: "Old Name"))
    let client = TrainStackClient(
      store: store,
      transport: FakeTransport([Reply(body: #"{"token":"new"}"#)]))
    try await client.signInWithApple(identityToken: "jwt", nonce: "n", fullName: nil)
    #expect(await client.isSignedIn)
    #expect(await client.accountName == nil)
    #expect(store.reads == 1)
  }

  @Test func signsOutOfThisDeviceEvenWhenTheServerCannotBeReached() async {
    let (client, transport, store) = client([Reply(fails: true)])
    await client.signOut()
    #expect(await !client.isSignedIn)
    #expect(await store.load() == nil)
    #expect(await transport.requests.first?.url?.path == "/api/auth/sign-out")
  }

  @Test func deletesTheAccountAndForgetsTheSession() async throws {
    let (client, transport, store) = client([json("{}")])
    try await client.deleteAccount()
    #expect(await store.load() == nil)
    #expect(await transport.requests.first?.url?.path == "/api/auth/delete-user")
  }

  @Test func keepsTheSessionWhenTheAccountCannotBeDeleted() async {
    let (client, _, store) = client([json(#"{"code":"SESSION_EXPIRED"}"#, status: 400)])
    await #expect(throws: StravaError.rejected("Sign in again, then delete the account.")) {
      try await client.deleteAccount()
    }
    #expect(await store.load() == session)
  }
}

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
    #expect(attempt.url.host == "www.strava.com")

    let start = try #require(await transport.requests.first)
    #expect(start.httpMethod == "POST")
    #expect(start.url?.path == "/strava/connect")
    let challenge = try #require(body(of: start)["code_challenge"] as? String)
    #expect(challenge.count == 43)
    #expect(!challenge.contains(attempt.verifier))

    let status = try await client.finishStravaConnection(
      attempt, callback: URL(string: "trainstackride://strava?connected=1")!)
    #expect(status == StravaStatus(isConnected: true, athleteName: "Ada Rider"))
    let finish = try #require(await transport.requests.last)
    #expect(finish.url?.path == "/strava/connect/complete")
    let verifier = try #require(body(of: finish)["code_verifier"] as? String)
    #expect(verifier == attempt.verifier)
    #expect((43...128).contains(verifier.count))
    // The server was given the SHA-256 of the verifier.
    let expected = Data(SHA256.hash(data: Data(verifier.utf8))).base64EncodedString()
      .replacingOccurrences(of: "+", with: "-").replacingOccurrences(of: "/", with: "_")
      .replacingOccurrences(of: "=", with: "")
    #expect(challenge == expected)
  }

  @Test func usesAFreshVerifierForEveryAttempt() async throws {
    let reply = json(#"{"url":"https://www.strava.com/oauth/authorize"}"#)
    let (client, _, _) = client([reply, reply])
    let first = try await client.startStravaConnection()
    let second = try await client.startStravaConnection()
    #expect(first.verifier != second.verifier)
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

struct StravaUploadTests {
  @Test func sendsTheFileAndWaitsForTheActivity() async throws {
    let (client, transport, _) = client([
      json(#"{"id":7,"status":"processing"}"#, status: 202),
      json(#"{"id":7,"status":"processing"}"#),
      json(#"{"id":7,"status":"ready","activityId":99}"#),
    ])
    let fit = Data([0x0E, 0x20, 0x01, 0x02])
    let upload = try await client.upload(fit, name: "Threshold 3x12", fileName: "ride.fit")

    #expect(upload.activityID == 99)
    #expect(upload.url.absoluteString == "https://www.strava.com/activities/99")
    let requests = await transport.requests
    #expect(requests.count == 3)
    let first = requests[0]
    #expect(first.httpMethod == "POST")
    let components = try #require(URLComponents(url: first.url!, resolvingAgainstBaseURL: false))
    #expect(components.path == "/strava/uploads")
    #expect(
      components.queryItems
        == [
          URLQueryItem(name: "name", value: "Threshold 3x12"),
          URLQueryItem(name: "fileName", value: "ride.fit"),
        ])
    #expect(first.value(forHTTPHeaderField: "Authorization") == "Bearer session-token")
    #expect(first.value(forHTTPHeaderField: "Content-Type") == "application/octet-stream")
    #expect(first.httpBody == fit)
    #expect(requests[1].url?.path == "/strava/uploads/7")
    #expect(requests[1].httpMethod == "GET")
  }

  @Test func recognisesARideStravaAlreadyHas() async {
    let (client, _, _) = client([
      json(
        #"{"id":7,"status":"error","error":"ride.fit duplicate of activity 4321","duplicateOf":4321}"#,
        status: 400)
    ])
    await #expect(throws: StravaError.duplicate(activityID: 4321)) {
      try await client.upload(Data([1]), name: "Ride", fileName: "ride.fit")
    }
  }

  @Test func passesOnWhyStravaTurnedTheFileDown() async {
    let (client, _, _) = client([
      json(#"{"id":7,"status":"processing"}"#, status: 202),
      json(#"{"id":7,"status":"error","error":"The file is empty."}"#),
    ])
    await #expect(throws: StravaError.rejected("The file is empty.")) {
      try await client.upload(Data([1]), name: "Ride", fileName: "ride.fit")
    }
  }

  @Test func explainsWhyTheServerRefusedTheRide() async {
    func failure(_ status: Int, _ body: String = "{}") async -> StravaError? {
      let (client, _, _) = client([json(body, status: status)])
      do {
        _ = try await client.upload(Data([1]), name: "Ride", fileName: "ride.fit")
        return nil
      } catch {
        return error as? StravaError
      }
    }
    #expect(await failure(409, #"{"error":"not_connected"}"#) == .notConnected)
    #expect(await failure(429) == .rateLimited)
    #expect(await failure(413) == .rejected("The ride is too large to upload."))
    #expect(await failure(502) == .unavailable)
    #expect(await failure(503, #"{"error":"strava_not_configured"}"#) == .notConfigured)
  }

  @Test func givesUpWaitingWhenStravaIsStillProcessing() async {
    let pending = json(#"{"id":7,"status":"processing"}"#)
    let (client, transport, _) = client(
      [json(pending.body, status: 202), pending, pending, pending], pollLimit: 3)
    await #expect(throws: StravaError.stillProcessing) {
      try await client.upload(Data([1]), name: "Ride", fileName: "ride.fit")
    }
    #expect(await transport.requests.count == 4)
  }

  @Test func reportsAnUnreachableServer() async {
    let (client, _, _) = client([Reply(fails: true)])
    await #expect(throws: StravaError.unavailable) {
      try await client.upload(Data([1]), name: "Ride", fileName: "ride.fit")
    }
  }
}

struct FeedbackTests {
  @Test func sendsFeedbackWithItsContextAndReturnsTheIssue() async throws {
    let (client, transport, _) = client([
      json(
        #"{"number":101,"url":"https://github.com/richard-better/trainstack/issues/101"}"#,
        status: 201)
    ])
    let issue = try await client.sendFeedback(
      "Show the FTP line",
      context: FeedbackContext(app: "Ride 0.4 (57)", system: "iOS 27.1", screen: "History"))

    #expect(
      issue
        == FeedbackIssue(
          number: 101, url: URL(string: "https://github.com/richard-better/trainstack/issues/101")!
        ))
    let request = try #require(await transport.requests.first)
    #expect(request.httpMethod == "POST")
    #expect(request.url?.absoluteString == "https://api.example.com/feedback")
    #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer session-token")
    let sent = try body(of: request)
    #expect(sent["message"] as? String == "Show the FTP line")
    #expect(
      sent["context"] as? [String: String]
        == ["app": "Ride 0.4 (57)", "system": "iOS 27.1", "screen": "History"])
  }

  @Test func needsASignIn() async {
    let (client, transport, _) = client([], signedIn: false)
    await #expect(throws: StravaError.signedOut) {
      try await client.sendFeedback("Hi", context: FeedbackContext())
    }
    #expect(await transport.requests.isEmpty)
  }

  @Test func explainsWhyTheServerTurnedItDown() async {
    func failure(_ status: Int) async -> (any Error)? {
      let (client, _, _) = client([json(#"{"error":"x"}"#, status: status)])
      do {
        _ = try await client.sendFeedback("Hi", context: FeedbackContext())
        return nil
      } catch {
        return error
      }
    }
    #expect(await failure(403) as? FeedbackError == .appleAccountRequired)
    #expect(await failure(429) as? FeedbackError == .tooMuch)
    #expect(await failure(503) as? FeedbackError == .notConfigured)
    #expect(await failure(502) as? StravaError == .unavailable)
    #expect(await failure(401) as? StravaError == .signedOut)
  }
}
