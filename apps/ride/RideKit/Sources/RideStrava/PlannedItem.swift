import Foundation
import RideData

public struct PlannedItem: Hashable, Codable, Identifiable, Sendable {
  public enum Content: Hashable, Sendable {
    case workout(body: Data, notes: String?)
    case note(title: String, notes: String?)
    case rest(notes: String?)
    case unknown(kind: String)
  }

  public struct Numbers: Hashable, Codable, Sendable {
    public var seconds: Double?
    public var meters: Double?
    public var load: Double?

    public init(seconds: Double?, meters: Double?, load: Double?) {
      self.seconds = seconds
      self.meters = meters
      self.load = load
    }
  }

  public enum State: String, Hashable, Codable, Sendable {
    case planned, completed, skipped, missed

    public init(from decoder: any Decoder) throws {
      self = State(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .planned
    }
  }

  public struct Skip: Hashable, Codable, Sendable {
    public var reason: String?

    public init(reason: String?) {
      self.reason = reason
    }
  }

  public struct Pairing: Hashable, Codable, Sendable {
    public enum Maker: String, Hashable, Codable, Sendable {
      case athlete, auto
    }

    public var activityId: String
    public var by: Maker

    public init(activityId: String, by: Maker) {
      self.activityId = activityId
      self.by = by
    }
  }

  public let id: String
  public var day: SettingDay
  public var position: Double
  public var content: Content
  public var planned: Numbers?
  public var skipped: Skip?
  public var state: State
  public var pairing: Pairing?
  public var compliance: PlannedCompliance?
  public var updatedAt: Date

  public init(
    id: String, day: SettingDay, position: Double = 0, content: Content, planned: Numbers? = nil,
    skipped: Skip? = nil, state: State = .planned, pairing: Pairing? = nil,
    compliance: PlannedCompliance? = nil, updatedAt: Date
  ) {
    self.id = id
    self.day = day
    self.position = position
    self.content = content
    self.planned = planned
    self.skipped = skipped
    self.state = state
    self.pairing = pairing
    self.compliance = compliance
    self.updatedAt = updatedAt
  }

  public var workout: TrainStackWorkout? {
    guard case .workout(let body, _) = content else { return nil }
    return try? JSONDecoder().decode(TrainStackWorkout.self, from: body)
  }

  public var rideability: Rideability? { workout?.rideability }

  public var isWorkout: Bool {
    if case .workout = content { return true }
    return false
  }

  public var notes: String? {
    switch content {
    case .workout(_, let notes), .note(_, let notes), .rest(let notes): notes
    case .unknown: nil
    }
  }
}

extension PlannedItem.Content: Codable {
  private enum Field: String, CodingKey {
    case kind, workout, notes, title
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: Field.self)
    let notes = try container.decodeIfPresent(String.self, forKey: .notes)
    switch try container.decode(String.self, forKey: .kind) {
    case "workout":
      self = .workout(
        body: try container.decode(JSONValue.self, forKey: .workout).data, notes: notes)
    case "note":
      self = .note(title: try container.decode(String.self, forKey: .title), notes: notes)
    case "rest":
      self = .rest(notes: notes)
    case let kind:
      self = .unknown(kind: kind)
    }
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: Field.self)
    switch self {
    case .workout(let body, let notes):
      try container.encode("workout", forKey: .kind)
      try container.encode(try JSONValue(data: body), forKey: .workout)
      try container.encodeIfPresent(notes, forKey: .notes)
    case .note(let title, let notes):
      try container.encode("note", forKey: .kind)
      try container.encode(title, forKey: .title)
      try container.encodeIfPresent(notes, forKey: .notes)
    case .rest(let notes):
      try container.encode("rest", forKey: .kind)
      try container.encodeIfPresent(notes, forKey: .notes)
    case .unknown(let kind):
      try container.encode(kind, forKey: .kind)
    }
  }
}
