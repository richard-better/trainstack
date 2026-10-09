import Foundation

public enum StravaError: Error, Equatable, Sendable {
  /// The rider turned Strava's request down.
  case denied
  /// The rider did not let Ride upload activities.
  case missingPermission
  /// The server has no Strava application set up.
  case notConfigured
  case signInFailed
  /// A sign-in came back that this one did not start.
  case stateMismatch
  /// There is no sign-in, or Strava no longer accepts it.
  case notConnected
  case rateLimited
  /// Strava or the server could not be reached.
  case unavailable
  /// Strava already has this ride, as `activityID` when it says which.
  case duplicate(activityID: Int?)
  /// Strava turned the file down, with its reason.
  case rejected(String)
  /// Strava is still working on an upload.
  case stillProcessing
}

extension StravaError: LocalizedError {
  public var errorDescription: String? {
    switch self {
    case .denied: "Strava sign-in was cancelled."
    case .missingPermission: "Ride needs permission to upload activities to Strava."
    case .notConfigured: "Strava isn't set up on the server yet."
    case .signInFailed: "Strava sign-in didn't work. Try again."
    case .stateMismatch: "That Strava sign-in didn't match the one Ride started. Try again."
    case .notConnected: "Connect Strava in Settings first."
    case .rateLimited: "Strava is asking Ride to slow down. Try again in a few minutes."
    case .unavailable: "Couldn't reach Strava. Check your connection and try again."
    case .duplicate: "This ride is already on Strava."
    case .rejected(let reason): "Strava didn't accept the ride: \(reason)"
    case .stillProcessing: "Strava is still processing the ride. It will appear shortly."
    }
  }
}
