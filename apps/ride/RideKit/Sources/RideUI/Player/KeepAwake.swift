import Foundation

#if os(iOS)
  import UIKit
#endif

/// Stops the screen from dimming and locking, and the Mac from napping, while a ride is on, so
/// the rider need not touch the device with sweaty hands to keep seeing the numbers.
final class KeepAwake {
  #if os(macOS)
    private var activity: NSObjectProtocol?
  #endif

  func begin() {
    #if os(iOS)
      UIApplication.shared.isIdleTimerDisabled = true
    #elseif os(macOS)
      guard activity == nil else { return }
      // `.userInitiated` also keeps App Nap from slowing the one second clock.
      activity = ProcessInfo.processInfo.beginActivity(
        options: [.userInitiated, .idleDisplaySleepDisabled], reason: "Riding a workout")
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
