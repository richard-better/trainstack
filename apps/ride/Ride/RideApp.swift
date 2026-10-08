import RideUI
import SwiftUI

@main
struct RideApp: App {
  init() {
    WatchSupport.activate()
  }

  var body: some Scene {
    WindowGroup {
      RootView()
    }
  }
}
