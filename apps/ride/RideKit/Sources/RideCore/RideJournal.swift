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

  public func finish() {
    try? handle?.close()
    handle = nil
    Self.keepAsTrace(url, in: Self.tracesDirectory(besideJournalIn: directory))
  }

  private static func keepAsTrace(_ journal: URL, in traces: URL) {
    let files = FileManager.default
    guard let data = try? Data(contentsOf: journal), let trace = RideTrace(jsonLines: data) else {
      try? files.removeItem(at: journal)
      return
    }
    try? files.createDirectory(at: traces, withIntermediateDirectories: true)
    let destination = traces.appending(path: traceFileName(startingAt: trace.header.startDate))
    try? files.removeItem(at: destination)
    if (try? files.moveItem(at: journal, to: destination)) == nil {
      try? files.removeItem(at: journal)
    }
    removeOldTraces(in: traces)
  }

  static func traceFileName(startingAt date: Date) -> String {
    date.formatted(.iso8601).replacing(":", with: "-") + ".jsonl"
  }

  private static func removeOldTraces(in traces: URL) {
    let files = FileManager.default
    let names = (try? files.contentsOfDirectory(atPath: traces.path)) ?? []
    for old in names.filter({ $0.hasSuffix(".jsonl") }).sorted().dropLast(tracesKept) {
      try? files.removeItem(at: traces.appending(path: old))
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

  public static func discard(in directory: URL = defaultDirectory) {
    try? FileManager.default.removeItem(at: directory.appending(path: fileName))
  }
}
