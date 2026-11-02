import Foundation
import Synchronization
import Testing

@testable import RideStrava

private final class CountingSessionStore: SessionStore {
  private let kept: AccountSession?
  private let count = Mutex(0)

  init(_ kept: AccountSession?) { self.kept = kept }

  var reads: Int { count.withLock { $0 } }

  func load() async -> AccountSession? {
    count.withLock { $0 += 1 }
    return kept
  }

  func save(_ session: AccountSession?) throws {}
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

  @Test func staysSignedOutWhenTheDeviceWillNotKeepTheSession() async {
    let client = TrainStackClient(
      store: SessionStoreThatWillNotKeepAnything(),
      transport: ScriptedTransport([Reply(body: #"{"token":"t"}"#)]))
    await #expect(throws: StravaError.sessionNotKept) {
      try await client.signInWithApple(identityToken: "jwt", nonce: "n", fullName: nil)
    }
    #expect(await !client.isSignedIn)
  }

  @Test func readsTheKeptSessionOnceWhenFirstNeeded() async {
    let store = CountingSessionStore(signedInSession)
    let client = TrainStackClient(store: store, transport: ScriptedTransport([]))
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
      transport: ScriptedTransport([Reply(body: #"{"token":"new"}"#)]))
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
    await #expect(throws: StravaError.rejected(reason: "Sign in again, then delete the account.")) {
      try await client.deleteAccount()
    }
    #expect(await store.load() == signedInSession)
  }
}
