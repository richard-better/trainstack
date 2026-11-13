import AuthenticationServices
import Foundation
import Observation
import RideStrava

@Observable
final class TrainStackAccount {
  private(set) var isRestoring = true
  private(set) var isSignedIn = false
  private(set) var name: String?
  private(set) var isStravaConnected = false
  private(set) var stravaAthleteName: String?
  @ObservationIgnored let client: TrainStackClient
  @ObservationIgnored var onSignInChange: (() -> Void)?

  init(
    server: URL = TrainStackClient.server, store: any SessionStore = KeychainSessionStore(),
    transport: any HTTPTransport = URLSession.shared
  ) {
    client = TrainStackClient(server: server, store: store, transport: transport)
  }

  func restore() async {
    guard isRestoring else { return }
    await refreshFromClient()
  }

  func signIn(identityToken: String, nonce: String, fullName: String?) async throws {
    try await client.signInWithApple(
      identityToken: identityToken, nonce: nonce, fullName: fullName)
    await refreshFromClient()
    onSignInChange?()
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
    onSignInChange?()
    await refreshStrava()
  }

  func signOut() async {
    await client.signOut()
    await refreshFromClient()
    onSignInChange?()
    isStravaConnected = false
    stravaAthleteName = nil
  }

  func deleteAccount() async throws {
    try await client.deleteAccount()
    await refreshFromClient()
    onSignInChange?()
    isStravaConnected = false
    stravaAthleteName = nil
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
