import SwiftUI

struct ChoosePlannedItemAction {
  private let handler: (PlannedItemAction) -> Void

  init(_ handler: @escaping (PlannedItemAction) -> Void) {
    self.handler = handler
  }

  func callAsFunction(_ action: PlannedItemAction) {
    handler(action)
  }
}

extension EnvironmentValues {
  @Entry var choosePlannedItemAction = ChoosePlannedItemAction { _ in }
}
