import SwiftUI

struct SyncWorkoutsAction {
  private let handler: () -> Void

  init(_ handler: @escaping () -> Void) {
    self.handler = handler
  }

  func callAsFunction() {
    handler()
  }
}

extension EnvironmentValues {
  @Entry var syncWorkouts = SyncWorkoutsAction {}
}
