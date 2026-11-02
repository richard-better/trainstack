import CoreTransferable
import CryptoKit
import Foundation
import RideData

nonisolated struct Ride: Identifiable, Sendable {
  let id: String
  let recording: RideRecording
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
