import Foundation

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

  var activityURL: URL? {
    switch self {
    case .sent(let url): url
    case .alreadyThere(let url): url
    case .failed: nil
    }
  }
}
