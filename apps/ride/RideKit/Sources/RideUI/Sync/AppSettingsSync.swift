import Foundation

#if os(iOS)
  import UIKit
#else
  import AppKit
#endif

enum AppSettingsSync {
  static let shared: SettingsSync = {
    let account = TrainStackAccount.launched
    let sync = SettingsSync(store: RiderSettingsStore.launched, server: account.client)
    account.observeSignInChanges { sync.accountChanged() }
    account.observeAccountDeletion { sync.accountDeleted($0) }
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
