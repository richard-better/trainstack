import SwiftUI

public struct FeedbackCommands: Commands {
  @FocusedValue(\.sendFeedback) private var sendFeedback

  public init() {}

  public var body: some Commands {
    CommandGroup(after: .help) {
      if let sendFeedback {
        Button("Send Feedback…") { sendFeedback() }
      }
    }
  }
}
