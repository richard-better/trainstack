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

  public func send(_ write: PlannedWrite, for account: ActivityAccount) async throws
    -> PlannedWriteResult
  {
    let stamp = { (date: Date) in Self.iso8601(date) }
    let (action, body): (String, [String: Any]) =
      switch write {
      case .skip(_, let reason, let updatedAt):
        (
          "skip",
          [
            "skipped": ["reason": reason.map { $0 as Any } ?? NSNull()],
            "updatedAt": stamp(updatedAt),
          ]
        )
      case .unskip(_, let updatedAt):
        ("skip", ["skipped": NSNull(), "updatedAt": stamp(updatedAt)])
      case .move(_, let day, let position, let updatedAt):
        ("move", ["day": day.text, "position": position, "updatedAt": stamp(updatedAt)])
      case .pair(_, let activityId, let updatedAt):
        ("pair", ["activityId": activityId, "updatedAt": stamp(updatedAt)])
      case .unpair(_, let activityId, let updatedAt):
        ("unpair", ["activityId": activityId, "updatedAt": stamp(updatedAt)])
      }
    let (data, response) = try await send(
      "POST", "\(Self.plannedPath)/\(write.plannedID)/\(action)", json: body, as: account)
    switch response.statusCode {
    case 410: return .deletedOnTheServer
    case 404, 413, 422:
      struct Refusal: Decodable { let code: String }
      guard let refusal = try? JSONDecoder().decode(Refusal.self, from: data) else {
        throw StravaError.unavailable
      }
      return .refused(code: refusal.code)
    default: try checkCalendarResponse(response, for: account)
    }
    do {
      return .stored(try Self.calendarDecoder.decode(PlannedItem.self, from: data))
    } catch {
      throw StravaError.unavailable
    }
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
