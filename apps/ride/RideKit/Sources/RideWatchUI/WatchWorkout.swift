import Foundation

struct WatchWorkout: Equatable {
  var startDate: Date
  var startedOnPhone: Bool
  var isRecordedElsewhere = false
  var lastHeardFromPhone: Date

  init(startDate: Date, startedOnPhone: Bool, lastHeardFromPhone: Date? = nil) {
    self.startDate = startDate
    self.startedOnPhone = startedOnPhone
    self.lastHeardFromPhone = lastHeardFromPhone ?? startDate
  }

  static let phoneSilenceLimit: TimeInterval = 5 * 60

  var savesToHealthItself: Bool { !startedOnPhone && !isRecordedElsewhere }

  func hasLostThePhone(at now: Date) -> Bool {
    startedOnPhone && now.timeIntervalSince(lastHeardFromPhone) >= Self.phoneSilenceLimit
  }
}
