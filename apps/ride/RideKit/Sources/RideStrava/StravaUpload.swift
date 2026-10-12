import Foundation

/// A ride Strava has made an activity of.
public struct StravaUpload: Equatable, Sendable {
  public var activityID: Int

  public init(activityID: Int) {
    self.activityID = activityID
  }

  public var url: URL { URL(string: "https://www.strava.com/activities/\(activityID)")! }
}

/// Whether the rider has connected Strava to their account.
public struct StravaStatus: Equatable, Sendable {
  public var isConnected: Bool
  public var athleteName: String?

  public init(isConnected: Bool, athleteName: String? = nil) {
    self.isConnected = isConnected
    self.athleteName = athleteName
  }
}
