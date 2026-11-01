import RideUI
import SwiftUI

@main
struct RideApp: App {
  init() {
    WatchSupport.activate()
    SyncSupport.activate()
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
