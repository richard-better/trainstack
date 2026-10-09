import Foundation

/// The rider's Strava sign-in, kept on the device. An access token lasts six hours; the refresh
/// token gets a new one.
public struct StravaTokens: Codable, Equatable, Sendable {
  public var accessToken: String
  public var refreshToken: String
  public var expiresAt: Date
  /// Who is signed in, to show in Settings.
  public var athleteName: String?

  public init(
    accessToken: String, refreshToken: String, expiresAt: Date, athleteName: String? = nil
  ) {
    self.accessToken = accessToken
    self.refreshToken = refreshToken
    self.expiresAt = expiresAt
    self.athleteName = athleteName
  }

  /// Whether the access token has run out, or will within `margin`.
  public func isExpiring(at date: Date, margin: TimeInterval = 60) -> Bool {
    expiresAt.timeIntervalSince(date) <= margin
  }
}
