import Foundation
import RideData

public protocol CalendarServer: Sendable {
  func signedInAccount() async throws -> ActivityAccount?
  func athleteTimeZone(for account: ActivityAccount) async throws -> TimeZone?
  func calendar(from: SettingDay, through: SettingDay, for account: ActivityAccount) async throws
    -> CalendarRange
  func plannedChanges(since cursor: String?, for account: ActivityAccount) async throws
    -> PlannedChanges
}
