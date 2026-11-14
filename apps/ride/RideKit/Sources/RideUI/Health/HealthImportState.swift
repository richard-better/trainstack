import RideData

struct HealthImportState: Codable, Equatable {
  var imported: Set<String> = []
  var deleted: Set<String> = []
  var sentDays: [SettingDay: MeasuredDay] = [:]
  var lastStamp = SettingStamp.beforeAnyEdit

  init() {}

  init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    imported = try container.decode(Set<String>.self, forKey: .imported)
    deleted = try container.decode(Set<String>.self, forKey: .deleted)
    sentDays =
      try container.decodeIfPresent([SettingDay: MeasuredDay].self, forKey: .sentDays) ?? [:]
    lastStamp =
      try container.decodeIfPresent(SettingStamp.self, forKey: .lastStamp) ?? .beforeAnyEdit
  }
}
