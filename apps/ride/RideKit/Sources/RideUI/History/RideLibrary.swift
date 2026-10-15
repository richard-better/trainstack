import Foundation
import Observation
import RideData

/// The finished rides, kept as FIT files in a folder when there is one.
@Observable
final class RideLibrary {
  /// Newest first.
  private(set) var rides: [Ride]
  /// What went wrong the last time a ride could not be written to the folder, until the rider
  /// has seen it. The ride stays in History for the rest of the session either way.
  var storageProblem: String?
  @ObservationIgnored private let directory: URL?
  @ObservationIgnored private var files: [Ride.ID: URL] = [:]

  /// Holds `rides` in memory only, for previews and sample rides.
  init(rides: [Ride] = []) {
    self.rides = rides.sorted { $0.recording.startDate > $1.recording.startDate }
    directory = nil
  }

  /// Loads the FIT files in `directory`, skipping any that cannot be read, and saves new rides
  /// there.
  init(directory: URL) {
    self.directory = directory
    rides = []
    let urls =
      (try? FileManager.default.contentsOfDirectory(
        at: directory, includingPropertiesForKeys: nil)) ?? []
    for url in urls where url.pathExtension == "fit" {
      guard let data = try? Data(contentsOf: url), let recording = try? FITDecoder.decode(data)
      else { continue }
      let ride = Ride(recording: recording, fileData: data)
      guard files[ride.id] == nil else { continue }
      rides.append(ride)
      files[ride.id] = url
    }
    rides.sort { $0.recording.startDate > $1.recording.startDate }
  }

  /// Where rides are kept between launches.
  static var storageDirectory: URL {
    URL.documentsDirectory.appending(path: "Rides", directoryHint: .isDirectory)
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
    let ride = Ride(recording: try FITDecoder.decode(data), fileData: data)
    guard self[ride.id] == nil else { return ride.id }
    rides.append(ride)
    rides.sort { $0.recording.startDate > $1.recording.startDate }
    store(ride)
    return ride.id
  }

  /// Adds a ride that has just been ridden.
  func save(_ recording: RideRecording) {
    do {
      try add(FITEncoder.encode(recording))
    } catch {
      storageProblem = "The ride could not be turned into a FIT file."
    }
  }

  func remove(_ id: Ride.ID) {
    rides.removeAll { $0.id == id }
    if let url = files.removeValue(forKey: id) { try? FileManager.default.removeItem(at: url) }
  }

  private func store(_ ride: Ride) {
    guard let directory else { return }
    do {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      let url = uniqueURL(for: ride.recording, in: directory)
      try ride.fileData.write(to: url, options: .atomic)
      files[ride.id] = url
    } catch {
      storageProblem =
        "\(ride.title) is in History for now, but could not be saved to this device: \(error.localizedDescription) Export it from its page to keep it."
    }
  }

  /// A file named for when the ride started, with a number added if that name is taken.
  private func uniqueURL(for recording: RideRecording, in directory: URL) -> URL {
    let stamp = recording.startDate.formatted(
      .iso8601.year().month().day().time(includingFractionalSeconds: false)
        .timeSeparator(.omitted).dateSeparator(.omitted).timeZone(separator: .omitted))
    var url = directory.appending(path: "\(stamp).fit")
    var number = 2
    while FileManager.default.fileExists(atPath: url.path) {
      url = directory.appending(path: "\(stamp)-\(number).fit")
      number += 1
    }
    return url
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
