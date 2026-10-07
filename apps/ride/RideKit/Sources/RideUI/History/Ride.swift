import CoreTransferable
import Foundation
import RideData

/// A finished ride in History.
nonisolated struct Ride: Identifiable, Sendable {
  let id = UUID()
  let recording: RideRecording
  /// The file as it was opened, kept so the ride can be shared or exported unchanged.
  let fileData: Data

  var title: String { recording.workoutName ?? "Ride" }

  var exportFileName: String { recording.exportFileName }
}

nonisolated extension Ride: Transferable {
  static var transferRepresentation: some TransferRepresentation {
    FileRepresentation(exportedContentType: .fitFile) { ride in
      let url = FileManager.default.temporaryDirectory.appending(path: ride.exportFileName)
      try ride.fileData.write(to: url)
      return SentTransferredFile(url)
    }
  }
}
