import Foundation
import RideData

struct PendingRidePairing: Hashable, Codable {
  let plannedID: String
  let rideID: String
  let rideDay: SettingDay
  let endedAt: Date
}
