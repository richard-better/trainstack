import Foundation
import RideData

extension TrainStackClient: CalendarServer {
  static let calendarPath = "api-reference/calendar"
  static let plannedPath = "api-reference/planned-workouts"

  static let calendarDecoder: JSONDecoder = {
    let decoder = JSONDecoder()
    decoder.dateDecodingStrategy = .custom { decoder in
      let text = try decoder.singleValueContainer().decode(String.self)
      guard let stamp = SettingStamp(iso8601: text) else {
        throw DecodingError.dataCorrupted(
          .init(codingPath: decoder.codingPath, debugDescription: "\(text) is not a date"))
      }
      return stamp.date
    }
    return decoder
  }()

  public func athleteTimeZone(for account: ActivityAccount) async throws -> TimeZone? {
    let (data, response) = try await send("GET", "api-reference/settings", as: account)
    try checkCalendarResponse(response, for: account)
    struct Settings: Decodable { let timeZone: String? }
    guard let settings = try? JSONDecoder().decode(Settings.self, from: data) else {
      throw StravaError.unavailable
    }
    return settings.timeZone.flatMap(TimeZone.init(identifier:))
  }

  public func calendar(from: SettingDay, through: SettingDay, for account: ActivityAccount)
    async throws -> CalendarRange
  {
    let (data, response) = try await send(
      "GET", Self.calendarPath,
      query: [
        URLQueryItem(name: "from", value: from.text),
        URLQueryItem(name: "through", value: through.text),
      ], as: account)
    try checkCalendarResponse(response, for: account)
    do {
      return try Self.calendarDecoder.decode(CalendarRange.self, from: data)
    } catch {
      throw StravaError.unavailable
    }
  }

  public func plannedChanges(since cursor: String?, for account: ActivityAccount) async throws
    -> PlannedChanges
  {
    let query = cursor.map { [URLQueryItem(name: "since", value: $0)] } ?? []
    let (data, response) = try await send(
      "GET", "\(Self.plannedPath)/changes", query: query, as: account)
    try checkCalendarResponse(response, for: account)
    struct Changes: Decodable {
      struct Written: Decodable { let id: String }
      let planned: [Written]
      let deleted: [Written]
      let cursor: String
    }
    guard let changes = try? JSONDecoder().decode(Changes.self, from: data) else {
      throw StravaError.unavailable
    }
    return PlannedChanges(
      changed: changes.planned.count + changes.deleted.count, cursor: changes.cursor)
  }

  func checkCalendarResponse(_ response: HTTPURLResponse, for account: ActivityAccount) throws {
    switch response.statusCode {
    case 200..<300: return
    case 401:
      if session?.token == account.token { forget() }
      throw StravaError.signedOut
    case 429: throw StravaError.rateLimited
    default: throw StravaError.unavailable
    }
  }
}
