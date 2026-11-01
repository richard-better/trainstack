import AuthenticationServices
import Foundation
import Observation
import RideStrava

/// The rider's TrainStack account, which Ride needs only to send rides to Strava, and the Strava
/// connection that hangs off it. Everything else in Ride works without either.
@Observable
final class TrainStackAccount {
  /// Whether the sign-in kept from an earlier launch is still being read. Until it is, the account
  /// is neither signed in nor out, as reading it can wait on a Keychain prompt.
  private(set) var isRestoring = true
  private(set) var isSignedIn = false
  private(set) var name: String?
  private(set) var isStravaConnected = false
  private(set) var stravaAthleteName: String?
  @ObservationIgnored private let client: TrainStackClient

  /// Starts out restoring; `restore()` picks up the sign-in kept in `store`.
  init(
    server: URL = TrainStackClient.server, store: any SessionStore = KeychainSessionStore(),
    transport: any HTTPTransport = URLSession.shared
  ) {
    client = TrainStackClient(server: server, store: store, transport: transport)
  }

  // MARK: Account

  /// Picks up a sign-in kept from an earlier launch, off the main actor.
  func restore() async {
    guard isRestoring else { return }
    await sync()
  }

  func signIn(identityToken: String, nonce: String, fullName: String?) async throws {
    try await client.signInWithApple(
      identityToken: identityToken, nonce: nonce, fullName: fullName)
    await sync()
    await refreshStrava()
  }

  func signOut() async {
    await client.signOut()
    await sync()
    isStravaConnected = false
    stravaAthleteName = nil
  }

  func deleteAccount() async throws {
    try await client.deleteAccount()
    await sync()
    isStravaConnected = false
    stravaAthleteName = nil
  }

  /// Shows what the client holds, which it has restored by the time it answers.
  private func sync() async {
    isSignedIn = await client.isSignedIn
    name = await client.accountName
    isRestoring = false
  }

  // MARK: Strava

  /// Asks whether Strava is connected. A failure leaves what was shown as it was.
  func refreshStrava() async {
    await restore()
    guard isSignedIn else { return }
    do {
      apply(try await client.stravaStatus())
    } catch {
      await sync()
    }
  }

  /// Connects Strava. `authenticate` shows `url` and returns the address it ends at, as a web
  /// authentication session does.
  func connectStrava(authenticate: (URL) async throws -> URL) async throws {
    do {
      let attempt = try await client.startStravaConnection()
      let callback: URL
      do {
        callback = try await authenticate(attempt.url)
      } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
        throw StravaError.cancelled
      }
      apply(try await client.finishStravaConnection(attempt, callback: callback))
    } catch {
      await sync()
      throw error
    }
  }

  func disconnectStrava() async throws {
    do {
      try await client.disconnectStrava()
      apply(StravaStatus(isConnected: false))
    } catch {
      await sync()
      throw error
    }
  }

  /// Sends `ride` to Strava as an indoor trainer ride.
  func upload(_ ride: Ride) async throws -> StravaUpload {
    do {
      return try await client.upload(
        ride.fileData, name: ride.title, fileName: ride.exportFileName)
    } catch {
      await sync()
      if case StravaError.notConnected = error { apply(StravaStatus(isConnected: false)) }
      throw error
    }
  }

  private func apply(_ status: StravaStatus) {
    isStravaConnected = status.isConnected
    stravaAthleteName = status.athleteName
  }

  /// Signed in with Strava connected, for previews.
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

  /// Not signed in, for previews.
  static var signedOut: TrainStackAccount {
    let account = TrainStackAccount(store: InMemorySessionStore())
    account.isRestoring = false
    return account
  }
}
