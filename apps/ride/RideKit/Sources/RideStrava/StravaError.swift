import Foundation

public enum StravaError: Error, Equatable, Sendable {
  case cancelled
  case missingPermission
  case notConfigured
  case signInFailed
  case sessionNotKept
  case connectFailed
  case athleteInUse
  case appleAccountRequired
  case signedOut
  case notConnected
  case rateLimited
  case unavailable
  case duplicate(activityID: Int?)
  case rejected(reason: String)
  case stillProcessing
}

extension StravaError: LocalizedError {
  public var errorDescription: String? {
    switch self {
    case .cancelled: "Cancelled."
    case .missingPermission: "Ride needs permission to upload activities to Strava."
    case .notConfigured: "Strava isn't set up on the server yet."
    case .signInFailed: "Sign in didn't work. Try again."
    case .sessionNotKept: "Ride couldn't keep your sign-in on this device. Try again."
    case .connectFailed: "Couldn't connect Strava. Try again."
    case .athleteInUse:
      "That Strava account is already connected to another TrainStack account. If it isn't yours to keep, remove Ride in Strava's settings under My Apps, then connect again."
    case .appleAccountRequired: "Sign in with Apple to connect Strava."
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
