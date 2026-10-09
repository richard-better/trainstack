import Foundation

public enum StravaError: Error, Equatable, Sendable {
  /// The rider backed out of signing in or connecting.
  case cancelled
  /// The rider did not let Ride upload activities.
  case missingPermission
  /// The server has no Strava application set up.
  case notConfigured
  /// Apple or the server did not accept the sign-in.
  case signInFailed
  case connectFailed
  /// There is no TrainStack account signed in, or the server no longer accepts its session.
  case signedOut
  /// The account has not connected Strava, or the rider revoked Ride in Strava.
  case notConnected
  case rateLimited
  /// The server or Strava could not be reached.
  case unavailable
  /// Strava already has this ride, as `activityID` when it says which.
  case duplicate(activityID: Int?)
  /// Strava or the server turned the file down, with its reason.
  case rejected(String)
  /// Strava is still working on an upload.
  case stillProcessing
}

extension StravaError: LocalizedError {
  public var errorDescription: String? {
    switch self {
    case .cancelled: "Cancelled."
    case .missingPermission: "Ride needs permission to upload activities to Strava."
    case .notConfigured: "Strava isn't set up on the server yet."
    case .signInFailed: "Sign in didn't work. Try again."
    case .connectFailed: "Couldn't connect Strava. Try again."
    case .signedOut: "Sign in to your TrainStack account in Settings first."
    case .notConnected: "Connect Strava in Settings first."
    case .rateLimited: "Strava is asking Ride to slow down. Try again in a few minutes."
    case .unavailable: "Couldn't reach the server. Check your connection and try again."
    case .duplicate: "This ride is already on Strava."
    case .rejected(let reason): "The ride wasn't accepted: \(reason)"
    case .stillProcessing: "Strava is still processing the ride. It will appear shortly."
    }
  }
}
