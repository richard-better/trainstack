import RideData

public struct SettingsHistory: Equatable, Sendable {
  public var writes: [SettingWrite]
  public var cursor: String?

  public init(writes: [SettingWrite], cursor: String?) {
    self.writes = writes
    self.cursor = cursor
  }
}
