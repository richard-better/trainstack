import Foundation

public struct StravaUpload: Equatable, Sendable {
  public var activityID: Int

  public init(activityID: Int) {
    self.activityID = activityID
  }

  public var url: URL { URL(string: "https://www.strava.com/activities/\(activityID)")! }
}
