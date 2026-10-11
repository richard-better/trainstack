import Foundation
import UserNotifications

enum UNReminder {
  static func schedule(time: String) async throws -> Bool {
    let center = UNUserNotificationCenter.current()
    guard try await center.requestAuthorization(options: [.alert, .sound, .badge]) else {
      return false
    }
    let parts = time.split(separator: ":").compactMap { Int($0) }
    guard parts.count >= 2 else { return false }
    let content = UNMutableNotificationContent()
    content.title = "A little time for your body"
    content.body = "Your daily Prehab practice is waiting."
    content.sound = .default
    let trigger = UNCalendarNotificationTrigger(
      dateMatching: DateComponents(hour: parts[0], minute: parts[1]), repeats: true)
    try await center.add(
      UNNotificationRequest(identifier: "prehab.daily", content: content, trigger: trigger))
    return true
  }
  static func cancel() {
    UNUserNotificationCenter.current().removePendingNotificationRequests(withIdentifiers: [
      "prehab.daily"
    ])
  }
}
