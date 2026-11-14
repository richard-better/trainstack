import Foundation

public struct TrainStackWorkout: Hashable, Codable, Sendable {
  public struct Sport: RawRepresentable, Hashable, Codable, Sendable {
    public let rawValue: String

    public init(rawValue: String) {
      self.rawValue = rawValue
    }

    public static let cycling = Sport(rawValue: "cycling")
    public static let running = Sport(rawValue: "running")
    public static let swimming = Sport(rawValue: "swimming")
  }

  public enum Focus: String, Hashable, Codable, Sendable {
    case recovery, endurance, tempo, threshold, vo2Max, anaerobic
  }

  public indirect enum Amount: Hashable, Sendable {
    case seconds(Double)
    case meters(Double)
    case untilLap(expected: Amount?)
    case unknown(String)
  }

  public enum Level: Hashable, Sendable {
    case constant(Double)
    case range(low: Double, high: Double)
    case ramp(from: Double, to: Double)
    case unknown(String)
  }

  public enum Target: Hashable, Sendable {
    case power(unit: String, level: Level)
    case pace(unit: String, level: Level)
    case heartRate(unit: String, level: Level)
    case maxEffort
    case unknown(String)
  }

  public struct Cue: Hashable, Sendable {
    public var at: Amount
    public var text: String
    public var shownForSeconds: Double?

    public init(at: Amount, text: String, shownForSeconds: Double? = nil) {
      self.at = at
      self.text = text
      self.shownForSeconds = shownForSeconds
    }
  }

  public struct Step: Hashable, Sendable {
    public var duration: Amount
    public var target: Target?
    public var cadence: Level?
    public var intensity: String?
    public var name: String?
    public var notes: String?
    public var cues: [Cue]

    public init(
      duration: Amount, target: Target? = nil, cadence: Level? = nil, intensity: String? = nil,
      name: String? = nil, notes: String? = nil, cues: [Cue] = []
    ) {
      self.duration = duration
      self.target = target
      self.cadence = cadence
      self.intensity = intensity
      self.name = name
      self.notes = notes
      self.cues = cues
    }
  }

  public struct Repeat: Hashable, Sendable {
    public var count: Int
    public var blocks: [Block]
    public var name: String?
    public var cues: [Cue]

    public init(count: Int, blocks: [Block], name: String? = nil, cues: [Cue] = []) {
      self.count = count
      self.blocks = blocks
      self.name = name
      self.cues = cues
    }
  }

  public indirect enum Block: Hashable, Sendable {
    case step(Step)
    case `repeat`(Repeat)
    case unknown(String)
  }

  public var name: String
  public var sport: Sport
  public var description: String?
  public var author: String?
  public var focus: Focus?
  public var tags: [String]
  public var blocks: [Block]

  public init(
    name: String, sport: Sport, description: String? = nil, author: String? = nil,
    focus: Focus? = nil, tags: [String] = [], blocks: [Block]
  ) {
    self.name = name
    self.sport = sport
    self.description = description
    self.author = author
    self.focus = focus
    self.tags = tags
    self.blocks = blocks
  }

  private enum CodingKeys: String, CodingKey {
    case name, sport, description, author, focus, tags, steps
  }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    name = try container.decode(String.self, forKey: .name)
    sport = try container.decode(Sport.self, forKey: .sport)
    description = try container.decodeIfPresent(String.self, forKey: .description)
    author = try container.decodeIfPresent(String.self, forKey: .author)
    focus = try? container.decodeIfPresent(Focus.self, forKey: .focus)
    tags = try container.decodeIfPresent([String].self, forKey: .tags) ?? []
    blocks = try container.decode([Block].self, forKey: .steps)
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(name, forKey: .name)
    try container.encode(sport, forKey: .sport)
    try container.encodeIfPresent(description, forKey: .description)
    try container.encodeIfPresent(author, forKey: .author)
    try container.encodeIfPresent(focus, forKey: .focus)
    if !tags.isEmpty { try container.encode(tags, forKey: .tags) }
    try container.encode(blocks, forKey: .steps)
  }
}
