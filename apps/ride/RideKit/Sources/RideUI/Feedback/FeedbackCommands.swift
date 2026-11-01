import SwiftUI

/// Send Feedback in the Help menu, on the Mac and in the shortcuts overlay on iPad. It is there
/// only while the focused window's rider is signed in.
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
