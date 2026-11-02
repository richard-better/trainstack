import RideUI
import SwiftUI

@main
struct RideApp: App {
  init() {
    WatchSupport.activateAtLaunch()
    SyncSupport.activateAtLaunch()
  }

  var body: some Scene {
    WindowGroup {
      RootView()
    }
    .commands {
      RideCommands()
      FeedbackCommands()
    }
  }
}
