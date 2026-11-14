import Foundation

public struct AccountActivityDetail: Hashable, Codable, Sendable {
  public struct Lap: Hashable, Codable, Sendable {
    public var startedAt: Date
    public var endedAt: Date?
    public var statistics: [String: Double]

    public init(startedAt: Date, endedAt: Date?, statistics: [String: Double]) {
      self.startedAt = startedAt
      self.endedAt = endedAt
      self.statistics = statistics
    }
  }

  public struct Route: Hashable, Codable, Sendable {
    public var segments: [String]

    public init(segments: [String]) {
      self.segments = segments
    }
  }

  public var laps: [Lap]
  public var route: Route?

  public init(laps: [Lap] = [], route: Route? = nil) {
    self.laps = laps
    self.route = route
  }

  private enum CodingKeys: String, CodingKey { case laps, route, events }

  private struct Event: Decodable {
    let type: String
    let startedAt: Date
    let endedAt: Date?
    let data: [String: JSONValue]
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    route = try? container.decode(Route.self, forKey: .route)
    if let laps = try? container.decode([Lap].self, forKey: .laps) {
      self.laps = laps
      return
    }
    let events = (try? container.decode([Event].self, forKey: .events)) ?? []
    laps = events.filter { $0.type == "lap" }.map { event in
      Lap(
        startedAt: event.startedAt, endedAt: event.endedAt,
        statistics: event.data.compactMapValues { if case .number(let n) = $0 { n } else { nil } })
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(laps, forKey: .laps)
    try container.encodeIfPresent(route, forKey: .route)
  }
}
