import Foundation
import RideData

extension TrainStackClient: SettingsServer {
  static let settingsHistoryPath = "api-reference/settings/history"
  public static let maxSettingWrites = 100

  public func settingsHistory(since cursor: String?, for account: ActivityAccount) async throws
    -> SettingsHistory
  {
    let query = cursor.map { [URLQueryItem(name: "since", value: $0)] } ?? []
    let (data, response) = try await send(
      "GET", Self.settingsHistoryPath, query: query, as: account)
    try checkSettingsResponse(response, for: account)
    struct History: Decodable {
      let entries: [Readable<Entry>]
      let removed: [Readable<Removal>]
      let cursor: String
    }
    guard let history = try? JSONDecoder().decode(History.self, from: data) else {
      throw StravaError.unavailable
    }
    let writes = history.entries.map { $0.value?.write } + history.removed.map { $0.value?.write }
    let everyChangeRead = writes.allSatisfy { $0 != nil }
    return SettingsHistory(
      writes: writes.compactMap(\.self), cursor: everyChangeRead ? history.cursor : nil)
  }

  public func writeSettings(_ writes: [SettingWrite], for account: ActivityAccount) async throws
    -> SettingsWriteResult
  {
    let body = try JSONEncoder().encode(["writes": writes.map(Outgoing.init)])
    let (data, response) = try await send(
      "POST", Self.settingsHistoryPath, body: body, contentType: "application/json", as: account)
    if response.statusCode == 422 {
      struct Refusal: Decodable {
        struct Detail: Decodable {
          let index: Int
          let reason: String
        }
        let data: Detail
      }
      guard let refusal = try? JSONDecoder().decode(Refusal.self, from: data) else {
        throw StravaError.unavailable
      }
      return .refused(index: refusal.data.index, reason: refusal.data.reason)
    }
    try checkSettingsResponse(response, for: account)
    struct Answer: Decodable {
      let entries: [Entry]
      let removed: [Removal]
    }
    guard let answer = try? JSONDecoder().decode(Answer.self, from: data) else {
      throw StravaError.unavailable
    }
    return .stored(answer.entries.map(\.write) + answer.removed.map(\.write))
  }

  private func checkSettingsResponse(_ response: HTTPURLResponse, for account: ActivityAccount)
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

  private struct Readable<Value: Decodable>: Decodable {
    let value: Value?

    init(from decoder: any Decoder) throws {
      value = try? Value(from: decoder)
    }
  }

  private struct Entry: Decodable {
    let write: SettingWrite

    private enum CodingKeys: String, CodingKey { case day, change, updatedAt }

    init(from decoder: any Decoder) throws {
      let container = try decoder.container(keyedBy: CodingKeys.self)
      let change = try container.decode(SettingChange.self, forKey: .change)
      write = SettingWrite(
        SettingAddress(change.key, on: try container.decode(SettingDay.self, forKey: .day)),
        change, at: try stamp(in: container, forKey: .updatedAt))
    }
  }

  private struct Removal: Decodable {
    let write: SettingWrite

    private enum CodingKeys: String, CodingKey { case day, key, updatedAt }

    init(from decoder: any Decoder) throws {
      let container = try decoder.container(keyedBy: CodingKeys.self)
      write = SettingWrite(
        SettingAddress(
          try container.decode(SettingKey.self, forKey: .key),
          on: try container.decode(SettingDay.self, forKey: .day)),
        nil, at: try stamp(in: container, forKey: .updatedAt))
    }
  }

  private struct Outgoing: Encodable {
    let write: SettingWrite

    private enum CodingKeys: String, CodingKey { case day, change, key, updatedAt, remove }

    func encode(to encoder: any Encoder) throws {
      var container = encoder.container(keyedBy: CodingKeys.self)
      try container.encode(write.address.day, forKey: .day)
      if let change = write.change {
        try container.encode(change, forKey: .change)
      } else {
        try container.encode(write.address.key, forKey: .key)
        try container.encode(true, forKey: .remove)
      }
      try container.encode(write.updatedAt.iso8601, forKey: .updatedAt)
    }
  }
}

private func stamp<Key: CodingKey>(in container: KeyedDecodingContainer<Key>, forKey key: Key)
  throws -> SettingStamp
{
  let text = try container.decode(String.self, forKey: key)
  guard let stamp = SettingStamp(iso8601: text) else {
    throw DecodingError.dataCorruptedError(
      forKey: key, in: container, debugDescription: "\(text) is not an ISO 8601 time")
  }
  return stamp
}
