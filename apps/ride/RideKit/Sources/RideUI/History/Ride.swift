import CoreTransferable
import CryptoKit
import Foundation
import RideData

/// A finished ride in History.
nonisolated struct Ride: Identifiable, Sendable {
  /// The SHA-256 of the file, so the same ride has the same ID on every device it reaches.
  let id: String
  let recording: RideRecording
  /// The file as it was opened, kept so the ride can be shared or exported unchanged.
  let fileData: Data

  init(recording: RideRecording, fileData: Data) {
    id = SHA256.hash(data: fileData).map { String(format: "%02x", $0) }.joined()
    self.recording = recording
    self.fileData = fileData
  }

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
