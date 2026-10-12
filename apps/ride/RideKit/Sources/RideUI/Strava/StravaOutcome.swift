import Foundation

/// How sending a ride to Strava ended, for the rider to read.
enum StravaOutcome: Identifiable {
  case sent(URL)
  case alreadyThere(URL?)
  case failed(String)

  var id: String {
    switch self {
    case .sent: "sent"
    case .alreadyThere: "alreadyThere"
    case .failed: "failed"
    }
  }

  var title: String {
    switch self {
    case .sent: "Sent to Strava"
    case .alreadyThere: "Already on Strava"
    case .failed: "Couldn't Send to Strava"
    }
  }

  var message: String {
    switch self {
    case .sent: "The ride is on your Strava."
    case .alreadyThere: "Strava already has this ride."
    case .failed(let reason): reason
    }
  }

  /// Where to see the activity on Strava, if there is one.
  var activityURL: URL? {
    switch self {
    case .sent(let url): url
    case .alreadyThere(let url): url
    case .failed: nil
    }
  }
}
