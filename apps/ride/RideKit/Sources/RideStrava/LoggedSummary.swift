import Foundation

public struct LoggedSummary: Hashable, Codable, Sendable {
  public var sport: String
  public var exercises: Int?
  public var sets: Int?
  public var reps: Int?
  public var volumeKg: Double?
  public var unit: String?
  public var problems: Int?
  public var tops: Int?
  public var sends: Int?
  public var flashes: Int?
  public var attempts: Int?
  public var hardestTop: String?
  public var hardestFlash: String?

  public init(
    sport: String, exercises: Int? = nil, sets: Int? = nil, reps: Int? = nil,
    volumeKg: Double? = nil, unit: String? = nil, problems: Int? = nil, tops: Int? = nil,
    sends: Int? = nil, flashes: Int? = nil, attempts: Int? = nil, hardestTop: String? = nil,
    hardestFlash: String? = nil
  ) {
    self.sport = sport
    self.exercises = exercises
    self.sets = sets
    self.reps = reps
    self.volumeKg = volumeKg
    self.unit = unit
    self.problems = problems
    self.tops = tops
    self.sends = sends
    self.flashes = flashes
    self.attempts = attempts
    self.hardestTop = hardestTop
    self.hardestFlash = hardestFlash
  }

  private enum CodingKeys: String, CodingKey {
    case summary, sport, exercises, sets, reps, volumeKg, unit, problems, tops, sends, flashes
    case attempts, hardestTop, hardestFlash
  }

  private enum GradeKeys: String, CodingKey { case grade, scale, colour }

  public init(from decoder: any Decoder) throws {
    let outer = try decoder.container(keyedBy: CodingKeys.self)
    let container =
      outer.contains(.summary)
      ? try outer.nestedContainer(keyedBy: CodingKeys.self, forKey: .summary) : outer
    sport = try container.decode(String.self, forKey: .sport)
    exercises = try? container.decode(Int.self, forKey: .exercises)
    sets = try? container.decode(Int.self, forKey: .sets)
    reps = try? container.decode(Int.self, forKey: .reps)
    volumeKg = try? container.decode(Double.self, forKey: .volumeKg)
    unit = try? container.decode(String.self, forKey: .unit)
    problems = try? container.decode(Int.self, forKey: .problems)
    tops = try? container.decode(Int.self, forKey: .tops)
    sends = try? container.decode(Int.self, forKey: .sends)
    flashes = try? container.decode(Int.self, forKey: .flashes)
    attempts = try? container.decode(Int.self, forKey: .attempts)
    hardestTop = Self.grade(in: container, forKey: .hardestTop)
    hardestFlash = Self.grade(in: container, forKey: .hardestFlash)
  }

  private static func grade(
    in container: KeyedDecodingContainer<CodingKeys>, forKey key: CodingKeys
  ) -> String? {
    if let text = try? container.decode(String.self, forKey: key) { return text }
    guard let value = try? container.nestedContainer(keyedBy: GradeKeys.self, forKey: key),
      let grade = try? value.nestedContainer(keyedBy: GradeKeys.self, forKey: .grade)
    else { return nil }
    return (try? grade.decode(String.self, forKey: .grade))
      ?? (try? grade.decode(String.self, forKey: .colour))
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(sport, forKey: .sport)
    try container.encodeIfPresent(exercises, forKey: .exercises)
    try container.encodeIfPresent(sets, forKey: .sets)
    try container.encodeIfPresent(reps, forKey: .reps)
    try container.encodeIfPresent(volumeKg, forKey: .volumeKg)
    try container.encodeIfPresent(unit, forKey: .unit)
    try container.encodeIfPresent(problems, forKey: .problems)
    try container.encodeIfPresent(tops, forKey: .tops)
    try container.encodeIfPresent(sends, forKey: .sends)
    try container.encodeIfPresent(flashes, forKey: .flashes)
    try container.encodeIfPresent(attempts, forKey: .attempts)
    try container.encodeIfPresent(hardestTop, forKey: .hardestTop)
    try container.encodeIfPresent(hardestFlash, forKey: .hardestFlash)
  }
}
