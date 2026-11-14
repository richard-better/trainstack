import Foundation
import RideData

extension TrainStackClient: WorkoutServer {
  static let workoutsPath = "api-reference/workouts"

  public func workoutChanges(since cursor: String?, for account: ActivityAccount) async throws
    -> WorkoutChanges
  {
    let data = try await changes(at: "\(Self.workoutsPath)/changes", since: cursor, for: account)
    struct Changes: Decodable {
      struct Deletion: Decodable { let id: String }
      let deleted: [Deletion]
      let cursor: String
    }
    guard let changes = try? JSONDecoder().decode(Changes.self, from: data),
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let written = object["workouts"] as? [[String: Any]]
    else { throw StravaError.unavailable }
    return WorkoutChanges(
      workouts: try written.map(Self.libraryWorkout), deleted: changes.deleted.map(\.id),
      cursor: changes.cursor)
  }

  public func workoutListChanges(since cursor: String?, for account: ActivityAccount)
    async throws -> WorkoutListChanges
  {
    let data = try await changes(
      at: "api-reference/workout-lists/changes", since: cursor, for: account)
    struct Changes: Decodable {
      struct List: Decodable {
        let id: String
        let name: String
        let workoutIds: [String]
        let updatedAt: String
      }
      struct Deletion: Decodable { let id: String }
      let lists: [List]
      let deleted: [Deletion]
      let cursor: String
    }
    guard let changes = try? JSONDecoder().decode(Changes.self, from: data) else {
      throw StravaError.unavailable
    }
    return WorkoutListChanges(
      lists: try changes.lists.map { list in
        LibraryWorkoutList(
          id: list.id, name: list.name, workoutIDs: list.workoutIds,
          updatedAt: try Self.date(list.updatedAt))
      }, deleted: changes.deleted.map(\.id), cursor: changes.cursor)
  }

  public func copyBuiltinWorkout(
    _ builtin: String, as id: String, updatedAt: Date, for account: ActivityAccount
  ) async throws -> WorkoutCopyResult {
    let body = try JSONEncoder().encode(["as": id, "updatedAt": Self.iso8601(updatedAt)])
    let (data, response) = try await send(
      "POST", "api-reference/builtin-workouts/\(builtin)/copy", body: body,
      contentType: "application/json", as: account)
    switch response.statusCode {
    case 410: return .deletedOnTheServer
    case 404, 422: return .refused(reason: String(decoding: data, as: UTF8.self))
    default: try checkWorkoutResponse(response, for: account)
    }
    guard let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
      throw StravaError.unavailable
    }
    return .stored(try Self.libraryWorkout(object))
  }

  public func deleteWorkout(_ id: String, for account: ActivityAccount) async throws {
    let (_, response) = try await send("DELETE", "\(Self.workoutsPath)/\(id)", as: account)
    try checkWorkoutResponse(response, for: account)
  }

  private func changes(at path: String, since cursor: String?, for account: ActivityAccount)
    async throws -> Data
  {
    let query = cursor.map { [URLQueryItem(name: "since", value: $0)] } ?? []
    let (data, response) = try await send("GET", path, query: query, as: account)
    try checkWorkoutResponse(response, for: account)
    return data
  }

  private func checkWorkoutResponse(_ response: HTTPURLResponse, for account: ActivityAccount)
    throws
  {
    switch response.statusCode {
    case 200..<300: return
    case 401:
      if session?.token == account.token { forget() }
      throw StravaError.signedOut
    case 429: throw StravaError.rateLimited
    default: throw StravaError.unavailable
    }
  }

  static func libraryWorkout(_ stored: [String: Any]) throws -> LibraryWorkout {
    guard let id = stored["id"] as? String, let name = stored["name"] as? String,
      let sport = stored["sport"] as? String, let updatedAt = stored["updatedAt"] as? String,
      let workout = stored["workout"], JSONSerialization.isValidJSONObject(workout)
    else { throw StravaError.unavailable }
    let origin = stored["origin"] as? [String: Any]
    return LibraryWorkout(
      id: id, name: name, sport: sport, focus: stored["focus"] as? String,
      description: stored["description"] as? String,
      copiedFromBuiltin: origin?["kind"] as? String == "builtin" ? origin?["id"] as? String : nil,
      updatedAt: try date(updatedAt),
      body: try JSONSerialization.data(withJSONObject: workout, options: [.sortedKeys]))
  }

  static func date(_ text: String) throws -> Date {
    guard let stamp = SettingStamp(iso8601: text) else { throw StravaError.unavailable }
    return stamp.date
  }

  static func iso8601(_ date: Date) -> String {
    SettingStamp(date).iso8601
  }
}
