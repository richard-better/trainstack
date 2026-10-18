import AuthenticationServices
import Foundation
import RideStrava
import Synchronization
import Testing

@testable import RideUI

/// Answers each request with the next reply and remembers the requests.
private actor FakeTransport: HTTPTransport {
  private(set) var requests: [URLRequest] = []
  private var replies: [(status: Int, body: String, headers: [String: String])]

  init(_ replies: [(status: Int, body: String, headers: [String: String])]) {
    self.replies = replies
  }

  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    requests.append(request)
    let reply = replies.isEmpty ? (status: 500, body: "{}", headers: [:]) : replies.removeFirst()
    let response = HTTPURLResponse(
      url: request.url!, statusCode: reply.status, httpVersion: nil, headerFields: reply.headers)!
    return (Data(reply.body.utf8), response)
  }
}

private func reply(_ body: String = "{}", status: Int = 200, headers: [String: String] = [:]) -> (
  status: Int, body: String, headers: [String: String]
) {
  (status: status, body: body, headers: headers)
}

private let session = AccountSession(token: "t", name: "Ada Rider")

/// Keeps the session back until the test releases it, like the Keychain while it waits for the
/// rider to answer a prompt.
private final class HeldSessionStore: SessionStore {
  private let readsStarted: AsyncStream<Void>
  private let readStarted: AsyncStream<Void>.Continuation
  private let released: AsyncStream<AccountSession?>
  private let releaser: AsyncStream<AccountSession?>.Continuation
  private let count = Mutex(0)

  init() {
    (readsStarted, readStarted) = AsyncStream.makeStream()
    (released, releaser) = AsyncStream.makeStream()
  }

  /// How many times the session has been read.
  var reads: Int { count.withLock { $0 } }

  func load() async -> AccountSession? {
    count.withLock { $0 += 1 }
    readStarted.yield()
    for await session in released { return session }
    return nil
  }

  func save(_ session: AccountSession?) {}

  /// Returns once a read has started.
  func asked() async {
    for await _ in readsStarted { return }
  }

  func release(_ session: AccountSession?) { releaser.yield(session) }
}

struct TrainStackAccountTests {
  @Test func picksUpASessionKeptFromAnEarlierLaunch() async {
    let account = TrainStackAccount(
      store: InMemorySessionStore(session), transport: FakeTransport([]))
    await account.restore()
    #expect(!account.isRestoring)
    #expect(account.isSignedIn)
    #expect(account.name == "Ada Rider")

    let signedOut = TrainStackAccount(store: InMemorySessionStore())
    await signedOut.restore()
    #expect(!signedOut.isRestoring)
    #expect(!signedOut.isSignedIn)
  }

  @Test func startsRestoringWithoutReadingTheStore() {
    let store = HeldSessionStore()
    let account = TrainStackAccount(store: store, transport: FakeTransport([]))
    #expect(account.isRestoring)
    #expect(!account.isSignedIn)
    #expect(store.reads == 0)
  }

  @Test func staysRestoringWhileTheStoreKeepsTheSessionBack() async {
    let store = HeldSessionStore()
    let account = TrainStackAccount(store: store, transport: FakeTransport([]))
    let restoring = Task { await account.restore() }
    await store.asked()

    // The main actor is free while the store holds on, as it is while a Keychain prompt waits.
    #expect(account.isRestoring)
    #expect(!account.isSignedIn)

    store.release(session)
    await restoring.value
    #expect(!account.isRestoring)
    #expect(account.isSignedIn)
    #expect(account.name == "Ada Rider")
  }

  @Test func signsInAndLearnsWhetherStravaIsConnected() async throws {
    let account = TrainStackAccount(
      store: InMemorySessionStore(),
      transport: FakeTransport([
        reply(#"{"user":{"name":"Ada Rider"}}"#, headers: ["set-auth-token": "t"]),
        reply(#"{"connected":true,"athleteName":"Ada R"}"#),
      ]))
    try await account.signIn(identityToken: "jwt", nonce: "n", fullName: nil)
    #expect(account.isSignedIn)
    #expect(account.name == "Ada Rider")
    #expect(account.isStravaConnected)
    #expect(account.stravaAthleteName == "Ada R")
  }

  @Test func signsInThroughTheWebSession() async throws {
    let transport = FakeTransport([
      reply(#"{"token":"t","user":{"name":"Ada Rider"}}"#),
      reply(#"{"connected":false}"#),
    ])
    let account = TrainStackAccount(store: InMemorySessionStore(), transport: transport)
    var opened: URL?
    try await account.signInThroughBrowser { url in
      opened = url
      return URL(string: "trainstackride://signed-in?code=c")!
    }
    #expect(opened?.path == "/api/auth/app-handoff/apple")
    #expect(account.isSignedIn)
    #expect(account.name == "Ada Rider")
    #expect(
      await transport.requests.map(\.url?.path) == ["/api/auth/app-handoff/token", "/strava"])
  }

  @Test func treatsBackingOutOfTheWebSignInAsCancelled() async {
    let account = TrainStackAccount(store: InMemorySessionStore(), transport: FakeTransport([]))
    await #expect(throws: StravaError.cancelled) {
      try await account.signInThroughBrowser { _ in
        throw ASWebAuthenticationSessionError(.canceledLogin)
      }
    }
    #expect(!account.isSignedIn)
  }

  @Test func signingOutForgetsStravaToo() async {
    let account = TrainStackAccount.sample
    #expect(account.isStravaConnected)
    await account.signOut()
    #expect(!account.isSignedIn)
    #expect(!account.isStravaConnected)
    #expect(account.stravaAthleteName == nil)
  }

  @Test func connectsStravaThroughTheWebSession() async throws {
    let transport = FakeTransport([
      reply(#"{"url":"https://www.strava.com/oauth/authorize?client_id=1"}"#),
      reply(#"{"connected":true,"athleteName":"Ada Rider"}"#),
    ])
    let account = TrainStackAccount(store: InMemorySessionStore(session), transport: transport)
    var opened: URL?
    try await account.connectStrava { url in
      opened = url
      return URL(string: "trainstackride://strava?connected=1")!
    }
    #expect(opened?.host == "www.strava.com")
    #expect(account.isStravaConnected)
    #expect(account.stravaAthleteName == "Ada Rider")
    #expect(await transport.requests.count == 2)
  }

  @Test func treatsBackingOutOfTheWebSessionAsCancelled() async {
    let account = TrainStackAccount(
      store: InMemorySessionStore(session),
      transport: FakeTransport([reply(#"{"url":"https://www.strava.com/oauth/authorize"}"#)]))
    await #expect(throws: StravaError.cancelled) {
      try await account.connectStrava { _ in
        throw ASWebAuthenticationSessionError(.canceledLogin)
      }
    }
    #expect(!account.isStravaConnected)
  }

  @Test func disconnectsStrava() async throws {
    let account = TrainStackAccount(
      store: InMemorySessionStore(session), transport: FakeTransport([reply(status: 204)]))
    try await account.disconnectStrava()
    #expect(!account.isStravaConnected)
  }

  @Test func sendsTheRidesFitFileUnderItsExportName() async throws {
    let ride = try #require(RideLibrary.sample().rides.first)
    let transport = FakeTransport([
      reply(#"{"id":7,"status":"ready","activityId":99}"#, status: 202)
    ])
    let account = TrainStackAccount(store: InMemorySessionStore(session), transport: transport)

    let upload = try await account.upload(ride)

    #expect(upload.activityID == 99)
    let request = try #require(await transport.requests.first)
    #expect(request.httpBody == ride.fileData)
    let query = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems
    #expect(query?.first { $0.name == "fileName" }?.value == ride.exportFileName)
  }

  @Test func signsOutWhenTheServerNoLongerAcceptsTheSession() async throws {
    let ride = try #require(RideLibrary.sample().rides.first)
    let account = TrainStackAccount(
      store: InMemorySessionStore(session), transport: FakeTransport([reply(status: 401)]))
    await #expect(throws: StravaError.signedOut) { try await account.upload(ride) }
    #expect(!account.isSignedIn)
  }

  @Test func marksStravaDisconnectedWhenTheRiderRevokedRide() async throws {
    let ride = try #require(RideLibrary.sample().rides.first)
    let revoked = TrainStackAccount(
      store: InMemorySessionStore(session),
      transport: FakeTransport([reply(#"{"connected":true}"#), reply(status: 409)]))
    await revoked.refreshStrava()
    #expect(revoked.isStravaConnected)
    await #expect(throws: StravaError.notConnected) { try await revoked.upload(ride) }
    #expect(!revoked.isStravaConnected)
  }
}

struct AppleSignInNonceTests {
  @Test func hashesTheNonceTheWayAppleExpects() {
    // SHA-256 of "abc" in hex.
    #expect(
      AppleSignInNonce(raw: "abc").hashed
        == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
  }

  @Test func makesANewHardToGuessNonceEveryTime() {
    let first = AppleSignInNonce()
    let second = AppleSignInNonce()
    #expect(first.raw != second.raw)
    #expect(first.raw.count == 64)
    #expect(first.hashed.count == 64)
  }
}
