import Foundation

#if os(iOS)
  import UIKit
#else
  import AppKit
#endif

enum AppActivitySync {
  static let shared: ActivitySync = {
    let account = TrainStackAccount.launched
    let sync = ActivitySync(library: RideLibrary.launched, server: account.client)
    account.observeSignInChanges { sync.accountChanged() }
    sync.onSignedOut = { Task { await account.refreshSignIn() } }
    #if os(iOS)
      let becameActive = UIApplication.didBecomeActiveNotification
    #else
      let becameActive = NSApplication.didBecomeActiveNotification
    #endif
    NotificationCenter.default.addObserver(forName: becameActive, object: nil, queue: .main) {
      _ in MainActor.assumeIsolated { sync.syncSoon() }
    }
    sync.start()
    return sync
  }()
}
