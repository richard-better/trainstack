import SwiftUI

/// Opens Send Feedback over the window. Only there while the rider is signed in, since feedback
/// goes through their account. Call it like a function, as with SwiftUI's `OpenURLAction`.
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
  /// Send Feedback for the focused window, for the Help menu.
  @Entry var sendFeedback: SendFeedbackAction?
}
