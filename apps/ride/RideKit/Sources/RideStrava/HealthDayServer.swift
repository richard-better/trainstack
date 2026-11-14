import RideData

public protocol HealthDayServer: Sendable {
  func writeHealthDays(_ days: [MeasuredDay], at stamp: SettingStamp, for account: ActivityAccount)
    async throws
}
