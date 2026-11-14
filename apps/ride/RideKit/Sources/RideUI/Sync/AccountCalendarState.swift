import Foundation
import RideData
import RideStrava

struct AccountCalendarState: Equatable, Codable {
  let account: String
  var timeZone: TimeZone?
  var range: CalendarRange?
  var rangeReadAt: Date?
  var plannedCursor: String?
  var writes: [PlannedWrite] = []
  var ridesToPair: [PendingRidePairing] = []
  var lastStamp: SettingStamp?

  init(account: String) {
    self.account = account
  }

  init(from decoder: any Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    account = try container.decode(String.self, forKey: .account)
    timeZone = try container.decodeIfPresent(TimeZone.self, forKey: .timeZone)
    range = try container.decodeIfPresent(CalendarRange.self, forKey: .range)
    rangeReadAt = try container.decodeIfPresent(Date.self, forKey: .rangeReadAt)
    plannedCursor = try container.decodeIfPresent(String.self, forKey: .plannedCursor)
    writes = try container.decodeIfPresent([PlannedWrite].self, forKey: .writes) ?? []
    ridesToPair =
      try container.decodeIfPresent([PendingRidePairing].self, forKey: .ridesToPair) ?? []
    lastStamp = try container.decodeIfPresent(SettingStamp.self, forKey: .lastStamp)
  }
}
