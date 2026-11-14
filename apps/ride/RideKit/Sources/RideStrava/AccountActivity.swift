import Foundation

public struct AccountActivity: Hashable, Codable, Identifiable, Sendable {
  public struct File: Hashable, Codable, Sendable {
    public var format: String
    public var size: Int

    public init(format: String, size: Int) {
      self.format = format
      self.size = size
    }
  }

  public let id: String
  public var source: String
  public var sport: String?
  public var indoor: Bool?
  public var name: String?
  public var startedAt: Date?
  public var createdAt: Date?
  public var file: File?
  public var summarizedAt: Date?
  public var analysisDue: Bool
  public var statistics: [String: Double]
  public var primary: Bool
  public var duplicateIDs: [String]
  public var logged: LoggedSummary?

  public init(
    id: String, source: String = "trainstack", sport: String? = "cycling", indoor: Bool? = true,
    name: String? = nil, startedAt: Date? = nil, createdAt: Date? = nil,
    file: File? = File(format: "fit", size: 1), summarizedAt: Date? = nil,
    analysisDue: Bool = false, statistics: [String: Double] = [:], primary: Bool = true,
    duplicateIDs: [String] = [], logged: LoggedSummary? = nil
  ) {
    self.id = id
    self.source = source
    self.sport = sport
    self.indoor = indoor
    self.name = name
    self.startedAt = startedAt
    self.createdAt = createdAt
    self.file = file
    self.summarizedAt = summarizedAt
    self.analysisDue = analysisDue
    self.statistics = statistics
    self.primary = primary
    self.duplicateIDs = duplicateIDs
    self.logged = logged
  }

  public var date: Date? { startedAt ?? createdAt }

  public var hasFIT: Bool { file?.format == "fit" }

  static let keptStatistics: Set<String> = [
    "elapsed_s", "timer_s", "distance_m", "calories_kcal", "average_speed_mps",
    "average_heart_rate_bpm", "max_heart_rate_bpm", "average_cadence_rpm", "average_power_w",
    "max_power_w", "ascent_m", "normalized_power_w", "work_kj", "load_tss",
    "average_grade_adjusted_speed_mps", "session_rpe_load_au",
  ]

  static func keeps(_ statistic: String) -> Bool {
    keptStatistics.contains(statistic)
      || (statistic.hasPrefix("time_in_") && statistic.contains("_zone_"))
  }

  private enum CodingKeys: String, CodingKey {
    case id, source, sport, indoor, name, startedAt, createdAt, file, summarizedAt, analysisDue
    case statistics, primary, duplicates, duplicateIDs, logged
  }

  private struct Duplicate: Decodable { let id: String }

  public init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    id = try container.decode(String.self, forKey: .id)
    source = (try? container.decode(String.self, forKey: .source)) ?? "upload"
    sport = try? container.decode(String.self, forKey: .sport)
    indoor = try? container.decode(Bool.self, forKey: .indoor)
    name = try? container.decode(String.self, forKey: .name)
    startedAt = try? container.decode(Date.self, forKey: .startedAt)
    createdAt = try? container.decode(Date.self, forKey: .createdAt)
    file = try? container.decode(File.self, forKey: .file)
    summarizedAt = try? container.decode(Date.self, forKey: .summarizedAt)
    analysisDue = (try? container.decode(Bool.self, forKey: .analysisDue)) ?? false
    statistics = ((try? container.decode([String: Double].self, forKey: .statistics)) ?? [:])
      .filter { Self.keeps($0.key) }
    primary = (try? container.decode(Bool.self, forKey: .primary)) ?? true
    duplicateIDs =
      (try? container.decode([String].self, forKey: .duplicateIDs))
      ?? ((try? container.decode([Duplicate].self, forKey: .duplicates)) ?? []).map(\.id)
    logged = try? container.decode(LoggedSummary.self, forKey: .logged)
  }

  public func encode(to encoder: any Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(id, forKey: .id)
    try container.encode(source, forKey: .source)
    try container.encodeIfPresent(sport, forKey: .sport)
    try container.encodeIfPresent(indoor, forKey: .indoor)
    try container.encodeIfPresent(name, forKey: .name)
    try container.encodeIfPresent(startedAt, forKey: .startedAt)
    try container.encodeIfPresent(createdAt, forKey: .createdAt)
    try container.encodeIfPresent(file, forKey: .file)
    try container.encodeIfPresent(summarizedAt, forKey: .summarizedAt)
    try container.encode(analysisDue, forKey: .analysisDue)
    try container.encode(statistics, forKey: .statistics)
    try container.encode(primary, forKey: .primary)
    try container.encode(duplicateIDs, forKey: .duplicateIDs)
    try container.encodeIfPresent(logged, forKey: .logged)
  }
}
