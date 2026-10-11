import PrehabUI
import SwiftUI

@main
struct PrehabApp: App {
  var body: some Scene {
    WindowGroup("TrainStack Prehab") { PrehabRootView().frame(minWidth: 700, minHeight: 600) }
      .defaultSize(width: 1000, height: 760)
  }
}
