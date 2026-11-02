import Foundation

#if os(iOS)
  import UIKit
#endif

final class KeepAwake {
  #if os(macOS)
    private var activity: NSObjectProtocol?
    private static let screenOnAndNoAppNapToSlowTheClock: ProcessInfo.ActivityOptions = [
      .userInitiated, .idleDisplaySleepDisabled,
    ]
  #endif

  func begin() {
    #if os(iOS)
      UIApplication.shared.isIdleTimerDisabled = true
    #elseif os(macOS)
      guard activity == nil else { return }
      activity = ProcessInfo.processInfo.beginActivity(
        options: Self.screenOnAndNoAppNapToSlowTheClock, reason: "Riding a workout")
    #endif
  }

  func end() {
    #if os(iOS)
      UIApplication.shared.isIdleTimerDisabled = false
    #elseif os(macOS)
      if let activity { ProcessInfo.processInfo.endActivity(activity) }
      activity = nil
    #endif
  }

  isolated deinit { end() }
}
