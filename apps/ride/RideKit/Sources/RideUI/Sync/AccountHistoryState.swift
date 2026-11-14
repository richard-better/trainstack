import RideStrava

struct AccountHistoryState: Codable, Equatable {
  var account: String
  var activities: [AccountActivity]
}
