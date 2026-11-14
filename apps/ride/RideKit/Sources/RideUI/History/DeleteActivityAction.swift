import RideStrava
import SwiftUI

struct DeleteActivityAction {
  private let handler: (AccountActivity.ID) -> Void

  init(_ handler: @escaping (AccountActivity.ID) -> Void) {
    self.handler = handler
  }

  func callAsFunction(_ id: AccountActivity.ID) {
    handler(id)
  }
}

extension EnvironmentValues {
  @Entry var deleteActivity = DeleteActivityAction { _ in }
}
