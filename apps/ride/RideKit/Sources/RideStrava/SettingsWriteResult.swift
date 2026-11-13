import RideData

public enum SettingsWriteResult: Equatable, Sendable {
  case stored([SettingWrite])
  case refused(index: Int, reason: String)
}
