import AuthenticationServices
import Foundation
import Observation
import RideStrava

/// Whether the rider is signed in to Strava, and what they can do once they are: sign in and out,
/// and send a ride.
@Observable
final class StravaConnection {
  private(set) var athleteName: String?
  private(set) var isConnected: Bool
  @ObservationIgnored private let client: StravaClient

  /// Picks up a sign-in kept from an earlier launch.
  init(
    store: any StravaTokenStore = KeychainStravaTokenStore(),
    transport: any StravaTransport = URLSession.shared
  ) {
    let tokens = store.load()
    isConnected = tokens != nil
    athleteName = tokens?.athleteName
    client = StravaClient(store: store, transport: transport)
  }

  /// Signs the rider in. `authenticate` shows `url` and returns the address it ends at, as a web
  /// authentication session does.
  func connect(authenticate: (URL) async throws -> URL) async throws {
    let signIn = StravaSignIn()
    let callback: URL
    do {
      callback = try await authenticate(signIn.authorizeURL())
    } catch let error as ASWebAuthenticationSessionError where error.code == .canceledLogin {
      throw StravaError.denied
    }
    let ticket = try signIn.ticket(from: callback)
    try await client.connect(ticket: ticket, signIn: signIn)
    await refresh()
  }

  func disconnect() async {
    await client.disconnect()
    await refresh()
  }

  /// Sends `ride` to Strava as an indoor trainer ride.
  func upload(_ ride: Ride) async throws -> StravaUpload {
    defer { Task { await refresh() } }
    return try await client.upload(ride.fileData, name: ride.title, fileName: ride.exportFileName)
  }

  private func refresh() async {
    isConnected = await client.isConnected
    athleteName = await client.athleteName
  }

  /// Signed in as someone, for previews.
  static var sample: StravaConnection {
    StravaConnection(
      store: InMemoryStravaTokenStore(
        StravaTokens(
          accessToken: "a", refreshToken: "r", expiresAt: .distantFuture, athleteName: "Ada Rider"))
    )
  }
}
