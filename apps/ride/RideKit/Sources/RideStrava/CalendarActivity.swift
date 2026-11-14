import Foundation

public struct CalendarActivity: Hashable, Codable, Identifiable, Sendable {
  public let id: String
  public var sport: String?
  public var indoor: Bool?
  public var name: String?
  public var startedAt: Date?
  public var seconds: Double?
  public var meters: Double?
  public var load: Double?
  public var analysisDue: Bool
  public var plannedId: String?

  public init(
    id: String, sport: String? = "cycling", indoor: Bool? = true, name: String? = nil,
    startedAt: Date? = nil, seconds: Double? = nil, meters: Double? = nil, load: Double? = nil,
    analysisDue: Bool = false, plannedId: String? = nil
  ) {
    self.id = id
    self.sport = sport
    self.indoor = indoor
    self.name = name
    self.startedAt = startedAt
    self.seconds = seconds
    self.meters = meters
    self.load = load
    self.analysisDue = analysisDue
    self.plannedId = plannedId
  }
}
