import Foundation
import Observation
import RideData

@Observable
final class RideLibrary {
  private(set) var rides: [Ride]
  var storageProblem: String?
  @ObservationIgnored var onLocalChange: ((Change) -> Void)?
  @ObservationIgnored private let directory: URL?
  @ObservationIgnored private var files: [Ride.ID: URL] = [:]
  private(set) var stravaActivities: [String: String]
  @ObservationIgnored private let defaults: UserDefaults?
  private static let stravaActivitiesKey = "stravaActivities"

  init(rides: [Ride] = []) {
    self.rides = rides.sorted { $0.recording.startDate > $1.recording.startDate }
    directory = nil
    defaults = nil
    stravaActivities = [:]
  }

  init(directory: URL, defaults: UserDefaults = .standard) {
    self.directory = directory
    self.defaults = defaults
    stravaActivities =
      defaults.dictionary(forKey: Self.stravaActivitiesKey) as? [String: String] ?? [:]
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

  static var storageDirectory: URL {
    URL.documentsDirectory.appending(path: "Rides", directoryHint: .isDirectory)
  }

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

  @discardableResult
  func add(_ data: Data, beforeStoring: (Ride) -> Void = { _ in }) throws -> Ride.ID {
    let ride = Ride(recording: try FITDecoder.decode(data), fileData: data)
    if insertIfNew(ride, beforeStoring: beforeStoring) { onLocalChange?(.added(ride.id)) }
    return ride.id
  }

  func receive(_ data: Data, beforeStoring: (Ride) -> Void = { _ in }) throws -> Ride.ID? {
    let ride = Ride(recording: try FITDecoder.decode(data), fileData: data)
    return insertIfNew(ride, beforeStoring: beforeStoring) ? ride.id : nil
  }

  private func insertIfNew(_ ride: Ride, beforeStoring: (Ride) -> Void = { _ in }) -> Bool {
    guard self[ride.id] == nil else { return false }
    beforeStoring(ride)
    rides.append(ride)
    rides.sort { $0.recording.startDate > $1.recording.startDate }
    store(ride)
    return true
  }

  @discardableResult
  func save(_ recording: RideRecording, beforeStoring: (Ride) -> Void = { _ in }) -> Ride.ID? {
    do {
      return try add(FITEncoder.encode(recording), beforeStoring: beforeStoring)
    } catch {
      storageProblem = "The ride could not be turned into a FIT file."
      return nil
    }
  }

  func remove(_ id: Ride.ID) {
    guard self[id] != nil else { return }
    removeReceived(id)
    onLocalChange?(.removed(id))
  }

  func removeReceived(_ id: Ride.ID) {
    rides.removeAll { $0.id == id }
    if let url = files.removeValue(forKey: id) { try? FileManager.default.removeItem(at: url) }
  }

  func isOnStrava(_ ride: Ride) -> Bool { stravaActivities[Self.stravaKey(ride)] != nil }

  func stravaURL(of ride: Ride) -> URL? {
    stravaActivities[Self.stravaKey(ride)].flatMap(URL.init(string:))
  }

  func markOnStrava(_ ride: Ride, url: URL?) {
    let key = Self.stravaKey(ride)
    if url == nil, stravaActivities[key] != nil { return }
    stravaActivities[key] = url?.absoluteString ?? ""
    defaults?.set(stravaActivities, forKey: Self.stravaActivitiesKey)
  }

  private static func stravaKey(_ ride: Ride) -> String {
    ride.recording.startDate.formatted(.iso8601)
  }

  func fileURL(for id: Ride.ID) -> URL? { files[id] }

  enum Change: Equatable {
    case added(Ride.ID)
    case removed(Ride.ID)
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

  var isStored: Bool { directory != nil }

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
