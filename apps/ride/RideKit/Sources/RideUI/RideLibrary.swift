import Foundation
import Observation
import RideData

/// The finished rides opened from FIT files.
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
    guard let recording = try? RideRecording.sample(),
      let data = try? RideRecording.sampleFITData()
    else { return RideLibrary() }
    return RideLibrary(rides: [Ride(recording: recording, fileData: data)])
  }
}
