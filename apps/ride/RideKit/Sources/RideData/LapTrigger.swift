import Foundation

public enum LapTrigger: Equatable, Sendable {
  case manual
  case time
  case sessionEnd
  case other

  init(fit value: Int) {
    self =
      switch value {
      case FITProfile.LapTriggerValue.manual: .manual
      case FITProfile.LapTriggerValue.time: .time
      case FITProfile.LapTriggerValue.sessionEnd: .sessionEnd
      default: .other
      }
  }

  var fit: UInt8 {
    let value =
      switch self {
      case .manual: FITProfile.LapTriggerValue.manual
      case .time: FITProfile.LapTriggerValue.time
      case .sessionEnd, .other: FITProfile.LapTriggerValue.sessionEnd
      }
    return UInt8(value)
  }
}
