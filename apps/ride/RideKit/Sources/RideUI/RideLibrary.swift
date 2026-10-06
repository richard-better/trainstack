import Observation
import RideData
import SwiftUI
import UniformTypeIdentifiers

extension UTType {
  /// FIT has no system type, so match on the file extension.
  nonisolated static let fitFile = UTType(filenameExtension: "fit") ?? .data
}

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

nonisolated struct FITDocument: FileDocument {
  static let readableContentTypes = [UTType.fitFile]
  let data: Data

  init(data: Data) { self.data = data }

  init(configuration: ReadConfiguration) throws {
    data = configuration.file.regularFileContents ?? Data()
  }

  func fileWrapper(configuration: WriteConfiguration) -> FileWrapper {
    FileWrapper(regularFileWithContents: data)
  }
}

@Observable
final class RideLibrary {
  /// Newest first.
  private(set) var rides: [Ride]

  init(rides: [Ride] = []) {
    self.rides = rides.sorted { $0.recording.startDate > $1.recording.startDate }
  }

  /// Adds the rides in `urls`. Returns a description of each file that could not be read.
  @discardableResult
  func open(_ urls: [URL]) -> [String] {
    var failures: [String] = []
    for url in urls {
      let hasAccess = url.startAccessingSecurityScopedResource()
      defer { if hasAccess { url.stopAccessingSecurityScopedResource() } }
      do {
        try add(Data(contentsOf: url))
      } catch {
        failures.append("\(url.lastPathComponent) is not a readable FIT file.")
      }
    }
    return failures
  }

  /// Decodes `data` and adds it, unless the same file is already in the library.
  @discardableResult
  func add(_ data: Data) throws -> Ride.ID {
    if let existing = rides.first(where: { $0.fileData == data }) { return existing.id }
    let ride = Ride(recording: try FITDecoder.decode(data), fileData: data)
    rides.append(ride)
    rides.sort { $0.recording.startDate > $1.recording.startDate }
    return ride.id
  }

  func remove(_ id: Ride.ID) {
    rides.removeAll { $0.id == id }
  }

  subscript(id: Ride.ID?) -> Ride? {
    id.flatMap { id in rides.first { $0.id == id } }
  }

  static func sample() -> RideLibrary {
    let library = RideLibrary()
    if let data = try? RideRecording.sampleFITData() { _ = try? library.add(data) }
    return library
  }
}
