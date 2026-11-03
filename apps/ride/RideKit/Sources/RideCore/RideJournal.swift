import Foundation
import RideData

public final class RideJournal {
  public static var defaultDirectory: URL {
    URL.applicationSupportDirectory.appending(path: "Ride in progress", directoryHint: .isDirectory)
  }

  public static func tracesDirectory(besideJournalIn directory: URL) -> URL {
    directory.deletingLastPathComponent().appending(
      path: "Ride traces", directoryHint: .isDirectory)
  }

  public static let tracesKept = 10

  private static let fileName = "ride.jsonl"

  private let directory: URL
  private var handle: FileHandle?
  private let encoder = JSONEncoder()

  private var url: URL { directory.appending(path: Self.fileName) }

  public init?(directory: URL = defaultDirectory, header: RideTrace.Header) {
    self.directory = directory
    do {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      FileManager.default.createFile(atPath: url.path, contents: nil)
      handle = try FileHandle(forWritingTo: url)
    } catch {
      return nil
    }
    write(header)
  }

  public init?(resuming directory: URL = defaultDirectory) {
    self.directory = directory
    do {
      let handle = try FileHandle(forWritingTo: directory.appending(path: Self.fileName))
      try handle.seekToEnd()
      try Self.endLineCutShortByACrash(in: handle)
      self.handle = handle
    } catch {
      return nil
    }
  }

  deinit { try? handle?.close() }

  public func append(_ input: RideInput) { write(input) }

  public func finish(keepingFor rideID: String? = nil) {
    try? handle?.close()
    handle = nil
    Self.keepAsTrace(url, for: rideID, in: Self.tracesDirectory(besideJournalIn: directory))
  }

  private static func keepAsTrace(_ journal: URL, for rideID: String?, in traces: URL) {
    let files = FileManager.default
    guard let data = try? Data(contentsOf: journal), let trace = RideTrace(jsonLines: data) else {
      try? files.removeItem(at: journal)
      return
    }
    try? files.createDirectory(at: traces, withIntermediateDirectories: true)
    let destination = traces.appending(
      path: traceFileName(startingAt: trace.header.startDate, rideID: rideID))
    try? files.removeItem(at: destination)
    if (try? files.moveItem(at: journal, to: destination)) == nil {
      try? files.removeItem(at: journal)
    }
    removeOldTraces(in: traces)
  }

  static func traceFileName(startingAt date: Date, rideID: String? = nil) -> String {
    let started = date.formatted(.iso8601).replacing(":", with: "-")
    return [started, rideID].compactMap(\.self).joined(separator: " ") + ".jsonl"
  }

  public static func traces(
    ofRide rideID: String, besideJournalIn directory: URL = defaultDirectory
  ) -> [URL] {
    let traces = tracesDirectory(besideJournalIn: directory)
    let names = (try? FileManager.default.contentsOfDirectory(atPath: traces.path)) ?? []
    return names.filter { rideName(of: $0) == rideID }.sorted().map { traces.appending(path: $0) }
  }

  private static func rideName(of fileName: String) -> String? {
    let stem = traceStem(of: fileName)
    guard let space = stem.firstIndex(of: " ") else { return nil }
    return String(stem[stem.index(after: space)...])
  }

  private static func traceStem(of fileName: String) -> Substring {
    fileName.prefix { $0 != "." }
  }

  private static func removeOldTraces(in traces: URL) {
    let files = FileManager.default
    let names = (try? files.contentsOfDirectory(atPath: traces.path)) ?? []
    let stems = Set(names.filter { $0.hasSuffix(".jsonl") }.map(traceStem(of:)))
    let old = Set(stems.sorted().dropLast(tracesKept))
    for name in names where old.contains(traceStem(of: name)) {
      try? files.removeItem(at: traces.appending(path: name))
    }
  }

  private static func endLineCutShortByACrash(in handle: FileHandle) throws {
    try handle.write(contentsOf: Data("\n".utf8))
  }

  private func write<Line: Encodable>(_ line: Line) {
    guard let handle else { return }
    do {
      try handle.write(contentsOf: encoder.encode(line) + Data("\n".utf8))
    } catch {
      try? handle.close()
      self.handle = nil
    }
  }

  public static func recover(from directory: URL = defaultDirectory) -> InterruptedRide? {
    guard let data = try? Data(contentsOf: directory.appending(path: fileName)),
      let trace = RideTrace(jsonLines: data)
    else { return nil }
    return InterruptedRide(trace: trace)
  }

  public static func finish(
    in directory: URL = defaultDirectory, keepingFor rideID: String? = nil
  ) {
    keepAsTrace(
      directory.appending(path: fileName), for: rideID,
      in: tracesDirectory(besideJournalIn: directory))
  }

  public static func discard(in directory: URL = defaultDirectory) {
    try? FileManager.default.removeItem(at: directory.appending(path: fileName))
  }
}
