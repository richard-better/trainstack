import RideStrava
import SwiftUI

/// Where a signed-in rider tells us what should change. It becomes a public GitHub issue, with
/// `context` but without their name.
struct FeedbackSheet: View {
  let context: FeedbackContext
  @Environment(TrainStackAccount.self) private var account
  @Environment(\.dismiss) private var dismiss
  @State private var message = ""
  @State private var isSending = false
  @State private var sent: FeedbackIssue?
  @State private var errorMessage: String?
  @FocusState private var isWriting: Bool

  var body: some View {
    NavigationStack {
      Group {
        if let sent {
          thanks(for: sent)
        } else {
          form
        }
      }
      .navigationTitle("Send Feedback")
      #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
      #endif
      .toolbar { toolbar }
    }
    #if os(macOS)
      .frame(minWidth: 460, minHeight: 360)
    #endif
    .interactiveDismissDisabled(isSending || (!message.isBlank && sent == nil))
    .alert("Couldn't Send Feedback", isPresented: errorShown) {
      Button("OK") {}
    } message: {
      Text(errorMessage ?? "")
    }
  }

  private var form: some View {
    Form {
      Section {
        TextField(
          "Feedback", text: $message,
          prompt: Text("What should change? For example, show my FTP on the ride chart."),
          axis: .vertical
        )
        .lineLimit(8, reservesSpace: true)
        .labelsHidden()
        .focused($isWriting)
        .disabled(isSending)
        .onChange(of: message) { _, text in
          // The most the server takes, which it counts in UTF-16.
          if text.utf16.count > 5000 {
            var length = 0
            message = String(
              text.prefix { character in
                length += character.utf16.count
                return length <= 5000
              })
          }
        }
      } footer: {
        Text(
          "Your feedback becomes a public issue on GitHub, without your name or account. Ride adds its version, your device and that you were on \(context.screen ?? "Ride")."
        )
      }
    }
    .formStyle(.grouped)
    .onAppear { isWriting = true }
  }

  private func thanks(for issue: FeedbackIssue) -> some View {
    ContentUnavailableView {
      Label("Thanks!", systemImage: "checkmark.bubble")
    } description: {
      Text("Your feedback is issue #\(issue.number) on GitHub.")
    } actions: {
      Link("View on GitHub", destination: issue.url)
    }
  }

  @ToolbarContentBuilder private var toolbar: some ToolbarContent {
    if sent == nil {
      ToolbarItem(placement: .cancellationAction) {
        Button("Cancel", action: close).disabled(isSending)
      }
      ToolbarItem(placement: .confirmationAction) {
        if isSending {
          ProgressView().accessibilityLabel("Sending")
        } else {
          Button("Send", action: send).disabled(message.isBlank)
        }
      }
    } else {
      ToolbarItem(placement: .confirmationAction) {
        Button("Done", action: close)
      }
    }
  }

  private func send() {
    Task {
      isSending = true
      defer { isSending = false }
      do {
        sent = try await account.sendFeedback(
          message.trimmingCharacters(in: .whitespacesAndNewlines), context: context)
      } catch {
        errorMessage = error.localizedDescription
      }
    }
  }

  private func close() { dismiss() }

  private var errorShown: Binding<Bool> {
    Binding(
      get: { errorMessage != nil },
      set: { if !$0 { errorMessage = nil } })
  }
}

extension String {
  fileprivate var isBlank: Bool { allSatisfy(\.isWhitespace) }
}

#Preview {
  FeedbackSheet(context: .current(screen: "History", window: nil))
    .environment(TrainStackAccount.sample)
}
