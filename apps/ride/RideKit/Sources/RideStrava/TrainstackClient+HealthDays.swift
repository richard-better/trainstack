import Foundation
import RideData

extension TrainstackClient: HealthDayServer {
  static let healthDaysPath = "api-reference/health-days"
  public static let maxHealthDayWrites = 100

  public func writeHealthDays(
    _ days: [MeasuredDay], at stamp: SettingStamp, for account: ActivityAccount
  ) async throws {
    let body = try JSONEncoder().encode(
      ["days": days.map { Outgoing(day: $0, updatedAt: stamp.iso8601) }])
    let (_, response) = try await send(
      "POST", Self.healthDaysPath, body: body, contentType: "application/json", as: account)
    switch response.statusCode {
    case 200..<300: return
    case 401:
      if session?.token == account.token { forget() }
      throw StravaError.signedOut
    case 429: throw StravaError.rateLimited
    default: throw StravaError.unavailable
    }
  }

  private struct Outgoing: Encodable {
    let day: MeasuredDay
    let updatedAt: String

    private enum CodingKeys: String, CodingKey {
      case day, source, sleepSeconds, restingHeartRateBpm, hrvMs, updatedAt
    }

    func encode(to encoder: any Encoder) throws {
      var container = encoder.container(keyedBy: CodingKeys.self)
      try container.encode(day.day, forKey: .day)
      try container.encode("apple_health", forKey: .source)
      try container.encode(day.sleepSeconds, forKey: .sleepSeconds)
      try container.encode(day.restingHeartRateBpm, forKey: .restingHeartRateBpm)
      try container.encode(day.hrvMs, forKey: .hrvMs)
      try container.encode(updatedAt, forKey: .updatedAt)
    }
  }
}
