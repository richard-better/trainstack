import Foundation

#if os(iOS)
  import UIKit
#else
  import AppKit
#endif

enum AppCalendarSync {
  static let shared: CalendarSync = {
    let account = TrainStackAccount.launched
    let sync = CalendarSync(calendar: AccountCalendar.launched, server: account.client)
    account.observeSignInChanges { sync.accountChanged() }
    account.observeAccountDeletion { sync.accountDeleted($0) }
    sync.onSignedOut = { Task { await account.refreshSignIn() } }
    AppActivitySync.shared.onUploaded = { sync.syncSoon() }
    #if os(iOS)
      let becameActive = UIApplication.didBecomeActiveNotification
    #else
      let becameActive = NSApplication.didBecomeActiveNotification
    #endif
    let center = NotificationCenter.default
    center.addObserver(forName: becameActive, object: nil, queue: .main) { _ in
      MainActor.assumeIsolated { sync.syncSoon() }
    }
    center.addObserver(forName: .NSCalendarDayChanged, object: nil, queue: .main) { _ in
      MainActor.assumeIsolated { sync.checkSoon() }
    }
    sync.start()
    return sync
  }()
}
