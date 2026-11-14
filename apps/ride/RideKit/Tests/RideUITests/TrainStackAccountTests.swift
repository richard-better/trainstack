import AuthenticationServices
import Foundation
import RideStrava
import Synchronization
import Testing

@testable import RideUI

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

  var readCount: Int { count.withLock { $0 } }

  func load() async -> AccountSession? {
    count.withLock { $0 += 1 }
    readStarted.yield()
    for await session in released { return session }
    return nil
  }

  func save(_ session: AccountSession?) {}

  func waitUntilAReadStarts() async {
    for await _ in readsStarted { return }
  }

  func release(_ session: AccountSession?) { releaser.yield(session) }
}

struct TrainStackAccountTests {
  @Test func tellsWhoListensWhichAccountWasDeletedAndThatSignInChanged() async throws {
    let account = TrainStackAccount(
      store: InMemorySessionStore(AccountSession(token: "t", name: "Ada", userID: "ada")),
      transport: FakeTransport([reply()]))
    var deleted: [String] = []
    var signInChanges = 0
    account.observeAccountDeletion { deleted.append($0) }
    account.observeSignInChanges { signInChanges += 1 }
    account.observeSignInChanges { signInChanges += 1 }
    try await account.deleteAccount()
    #expect(deleted == ["ada"])
    #expect(signInChanges == 2)
    #expect(!account.isSignedIn)
  }

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
    #expect(store.readCount == 0)
  }

  @Test func staysRestoringWhileTheStoreKeepsTheSessionBack() async {
    let store = HeldSessionStore()
    let account = TrainStackAccount(store: store, transport: FakeTransport([]))
    let restoring = Task { await account.restore() }
    await store.waitUntilAReadStarts()

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

  @Test func signsInThroughTheWebSessionAfterTheLaunchRestoredNoSession() async throws {
    let transport = FakeTransport([
      reply(#"{"token":"t","user":{"name":"Ada Rider"}}"#),
      reply(#"{"connected":false}"#),
    ])
    let account = TrainStackAccount(store: InMemorySessionStore(), transport: transport)
    await account.restore()
    #expect(!account.isSignedIn)
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

  @Test func aFailedStravaCheckLeavesTheConnectionAsShown() async {
    let account = TrainStackAccount(
      store: InMemorySessionStore(session),
      transport: FakeTransport([
        reply(#"{"connected":true,"athleteName":"Ada R"}"#), reply(status: 500),
      ]))
    await account.refreshStrava()
    await account.refreshStrava()
    #expect(account.isSignedIn)
    #expect(account.isStravaConnected)
    #expect(account.stravaAthleteName == "Ada R")
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

  @Test func aSessionTheActivitiesAPIRejectsShowsAsSignedOut() async throws {
    let directory = FileManager.default.temporaryDirectory.appending(
      path: "TrainStackAccountTests-\(UUID().uuidString)", directoryHint: .isDirectory)
    defer { try? FileManager.default.removeItem(at: directory) }
    let account = TrainStackAccount(
      store: InMemorySessionStore(AccountSession(token: "t", name: "Ada", userID: "ada")),
      transport: FakeTransport([reply(status: 401)]))
    await account.restore()
    #expect(account.isSignedIn)
    let library = RideLibrary(directory: directory.appending(path: "Rides"))
    let sync = ActivitySync(
      library: library, server: account.client, directory: directory.appending(path: "State"))
    let signedOut = AsyncStream<Void>.makeStream()
    sync.onSignedOut = {
      Task {
        await account.refreshSignIn()
        signedOut.continuation.yield()
      }
    }
    sync.start()
    for await _ in signedOut.stream { break }
    #expect(!account.isSignedIn)
  }
}
