import Foundation
import RideData

public enum PlannedWrite: Hashable, Codable, Sendable {
  case skip(id: String, reason: String?, updatedAt: Date)
  case unskip(id: String, updatedAt: Date)
  case move(id: String, day: SettingDay, position: Double, updatedAt: Date)
  case pair(id: String, activityId: String, updatedAt: Date)
  case unpair(id: String, activityId: String, updatedAt: Date)

  public var plannedID: String {
    switch self {
    case .skip(let id, _, _), .unskip(let id, _), .move(let id, _, _, _), .pair(let id, _, _),
      .unpair(let id, _, _):
      id
    }
  }
}
