import RideWatchUI
import SwiftUI

@main
struct RideWatchApp: App {
  @WKApplicationDelegateAdaptor private var delegate: RideWatchDelegate

  var body: some Scene {
    WindowGroup {
      WatchRootView()
    }
  }
}
