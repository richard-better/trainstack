import RideData

public protocol SettingsServer: Sendable {
  func signedInAccount() async throws -> ActivityAccount?
  func settingsHistory(since cursor: String?, for account: ActivityAccount) async throws
    -> SettingsHistory
  func writeSettings(_ writes: [SettingWrite], for account: ActivityAccount) async throws
    -> SettingsWriteResult
}
