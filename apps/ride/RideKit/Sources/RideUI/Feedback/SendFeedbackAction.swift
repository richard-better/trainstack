import SwiftUI

struct SendFeedbackAction {
  private let handler: () -> Void

  init(_ handler: @escaping () -> Void) {
    self.handler = handler
  }

  func callAsFunction() {
    handler()
  }
}

extension EnvironmentValues {
  @Entry var sendFeedback: SendFeedbackAction?
}

extension FocusedValues {
  @Entry var sendFeedback: SendFeedbackAction?
}
