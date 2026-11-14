import Foundation
import RideStrava

struct AccountCalendarState: Equatable, Codable {
  let account: String
  var timeZone: TimeZone?
  var range: CalendarRange?
  var rangeReadAt: Date?
  var plannedCursor: String?

  init(account: String) {
    self.account = account
  }
}
