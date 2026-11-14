import AuthenticationServices
import Foundation
import Observation
import RideStrava
import os

@Observable
final class TrainStackAccount {
  private(set) var isRestoring = true
  private(set) var isSignedIn = false
  private(set) var name: String?
  private(set) var isStravaConnected = false
  private(set) var stravaAthleteName: String?
  @ObservationIgnored let client: TrainStackClient
  @ObservationIgnored private var signInObservers: [() -> Void] = []
  @ObservationIgnored private var deletionObservers: [(String) -> Void] = []
  @ObservationIgnored private(set) var keepingAppleAuthorization: Task<Void, Never>?
  @ObservationIgnored private let log = Logger(
    subsystem: "com.trainstackhq.ride", category: "account")

  init(
    server: URL = TrainStackClient.server, store: any SessionStore = KeychainSessionStore(),
    transport: any HTTPTransport = URLSession.shared
  ) {
    client = TrainStackClient(server: server, store: store, transport: transport)
  }

  func observeSignInChanges(_ observer: @escaping () -> Void) {
    signInObservers.append(observer)
  }

  func observeAccountDeletion(_ observer: @escaping (String) -> Void) {
    deletionObservers.append(observer)
  }

  private func signInChanged() {
    for observer in signInObservers { observer() }
  }

  func restore() async {
    guard isRestoring else { return }
    await refreshFromClient()
  }

  func signIn(
    identityToken: String, nonce: String, fullName: String?, authorizationCode: String?
  ) async throws {
    try await client.signInWithApple(
      identityToken: identityToken, nonce: nonce, fullName: fullName)
    if let authorizationCode {
      keepingAppleAuthorization = Task { await keepAppleAuthorization(code: authorizationCode) }
    }
    await refreshFromClient()
    signInChanged()
    await refreshStrava()
  }

  func signInThroughBrowser(
    showingInAWebAuthenticationSession authenticate: (URL) async throws -> URL
  ) async throws {
    let attempt = await client.startAppleWebSignIn()
    let callback: URL
    do {
      callback = try await authenticate(attempt.url)
    } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
      throw StravaError.cancelled
    }
    try await client.finishAppleWebSignIn(attempt, callback: callback)
    await refreshFromClient()
    signInChanged()
    await refreshStrava()
  }

  func signOut() async {
    await client.signOut()
    await refreshFromClient()
    signInChanged()
    isStravaConnected = false
    stravaAthleteName = nil
  }

  func deleteAccount(
    askingAppleForAnAuthorizationCode askApple: () async throws -> String? = { nil }
  ) async throws {
    guard let deleted = try await client.signedInAccount() else { throw StravaError.signedOut }
    do {
      if let code = try await askApple() { await keepAppleAuthorization(code: code) }
    } catch {
      log.notice(
        "No fresh Apple authorization before deleting the account: \(String(describing: error), privacy: .public)"
      )
    }
    try await client.deleteAccount()
    await refreshFromClient()
    for observer in deletionObservers { observer(deleted.id) }
    signInChanged()
    isStravaConnected = false
    stravaAthleteName = nil
  }

  private func keepAppleAuthorization(code: String) async {
    do {
      try await client.keepAppleAuthorization(code: code)
    } catch {
      log.error("Apple authorization code not kept: \(String(describing: error), privacy: .public)")
    }
  }

  func refreshSignIn() async {
    await refreshFromClient()
  }

  private func refreshFromClient() async {
    isSignedIn = await client.isSignedIn
    name = await client.accountName
    isRestoring = false
  }

  func refreshStrava() async {
    await restore()
    guard isSignedIn else { return }
    do {
      apply(try await client.stravaStatus())
    } catch {
      await refreshFromClient()
    }
  }

  func connectStrava(authenticate: (URL) async throws -> URL) async throws {
    do {
      let attempt = try await client.startStravaConnection()
      let callback: URL
      do {
        callback = try await authenticate(attempt.authorizationURL)
      } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
        throw StravaError.cancelled
      }
      apply(try await client.finishStravaConnection(attempt, callback: callback))
    } catch {
      await refreshFromClient()
      throw error
    }
  }

  func disconnectStrava() async throws {
    do {
      try await client.disconnectStrava()
      apply(StravaStatus(isConnected: false))
    } catch {
      await refreshFromClient()
      throw error
    }
  }

  func upload(_ ride: Ride) async throws -> StravaUpload {
    do {
      return try await client.upload(
        ride.fileData, name: ride.title, fileName: ride.exportFileName)
    } catch {
      await refreshFromClient()
      if case StravaError.notConnected = error { apply(StravaStatus(isConnected: false)) }
      throw error
    }
  }

  func sendFeedback(_ message: String, context: FeedbackContext) async throws -> FeedbackIssue {
    do {
      return try await client.sendFeedback(message, context: context)
    } catch {
      await refreshFromClient()
      throw error
    }
  }

  private func apply(_ status: StravaStatus) {
    isStravaConnected = status.isConnected
    stravaAthleteName = status.athleteName
  }

  static var sample: TrainStackAccount {
    let account = TrainStackAccount(
      store: InMemorySessionStore(AccountSession(token: "t", name: "Ada Rider")))
    account.isRestoring = false
    account.isSignedIn = true
    account.name = "Ada Rider"
    account.isStravaConnected = true
    account.stravaAthleteName = "Ada Rider"
    return account
  }

  static var signedOut: TrainStackAccount {
    let account = TrainStackAccount(store: InMemorySessionStore())
    account.isRestoring = false
    return account
  }
}
