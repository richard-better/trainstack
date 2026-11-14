#if os(iOS)
  import Foundation
  import UIKit

  enum AppHealthImport {
    static let workouts = HealthKitWorkouts(
      appBundleIdentifier: Bundle.main.bundleIdentifier ?? "com.trainstackhq.ride")

    static let shared: HealthImport = {
      let account = TrainstackAccount.launched
      let health = HealthImport(store: workouts, server: account.client)
      account.observeSignInChanges { health.accountChanged() }
      health.onSignedOut = { Task { await account.refreshSignIn() } }
      NotificationCenter.default.addObserver(
        forName: UIApplication.didBecomeActiveNotification, object: nil, queue: .main
      ) { _ in MainActor.assumeIsolated { health.syncSoon() } }
      workouts.observeWorkouts { Task { @MainActor in health.syncSoon() } }
      health.syncSoon()
      return health
    }()
  }
#endif
