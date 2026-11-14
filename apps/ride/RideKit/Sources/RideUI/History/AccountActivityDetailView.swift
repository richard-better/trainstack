import RideData
import RideStrava
import SwiftUI

struct AccountActivityDetailView: View {
  let activity: AccountActivity
  let library: RideLibrary
  var onDelete: () -> Void
  @Environment(AccountHistory.self) private var history
  @State private var ride: Ride?
  @State private var file = FileState.notNeeded
  @State private var isConfirmingDelete = false

  static let deletionMessage =
    "It is deleted from your Trainstack account, on the web and on every device."

  enum FileState: Equatable {
    case notNeeded, downloading, needsConnection, unreadable
  }

  var body: some View {
    Group {
      if let ride {
        ActivityDetailView(
          ride: ride, library: library, activity: activity, isOnlyOnTheAccount: true,
          onRemove: onDelete)
      } else {
        AccountActivitySummaryView(activity: activity, file: file, retry: retry)
          .toolbar {
            ToolbarItem {
              Menu("More", systemImage: "ellipsis") {
                Button(
                  "Delete Activity", systemImage: "trash", role: .destructive,
                  action: confirmDelete)
              }
            }
          }
          .confirmationDialog("Delete this activity?", isPresented: $isConfirmingDelete) {
            Button("Delete Activity", role: .destructive, action: onDelete)
          } message: {
            Text(Self.deletionMessage)
          }
      }
    }
    .task(id: activity.id) { await open() }
  }

  private func confirmDelete() { isConfirmingDelete = true }

  private func retry() {
    Task { await open() }
  }

  private func open() async {
    guard activity.hasFIT, ride == nil else { return }
    file = .downloading
    do {
      let data = try await history.download(activity.id)
      guard let recording = try? FITDecoder.decode(data) else {
        file = .unreadable
        return
      }
      ride = Ride(recording: recording, fileData: data)
    } catch is CancellationError {
      return
    } catch {
      file = .needsConnection
    }
  }
}
