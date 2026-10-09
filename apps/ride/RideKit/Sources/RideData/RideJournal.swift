import Foundation

/// A record of the ride in progress, kept on disk as it is ridden so that a crash does not lose
/// it. One JSON object per line: a header when the ride starts, then an entry each second.
///
/// A line is only ever added to the end, so a crash can damage at most the last one, which
/// `recover` skips. Writing is best effort: a ride carries on without its journal if the
/// journal cannot be written.
public final class RideJournal {
  public struct Header: Codable, Sendable {
    public var template: WorkoutTemplate
    public var ftp: Int
    public var startDate: Date

    public init(template: WorkoutTemplate, ftp: Int, startDate: Date) {
      self.template = template
      self.ftp = ftp
      self.startDate = startDate
    }
  }

  /// One second of the ride: the state it ended in, and the sample it recorded unless it was
  /// paused.
  public struct Entry: Codable, Sendable {
    public var state: RideSession.State
    public var sample: RideSession.LiveSample?

    public init(state: RideSession.State, sample: RideSession.LiveSample?) {
      self.state = state
      self.sample = sample
    }
  }

  /// A ride that was not ended, as far as its journal got.
  public struct Interrupted: Sendable {
    public let header: Header
    public let state: RideSession.State
    public let samples: [RideSession.LiveSample]

    public var name: String { header.template.name }

    /// The ride as it stood, paused so the rider can pick it up when ready.
    public func session() -> RideSession {
      var state = state
      state.isPaused = true
      return RideSession(
        workout: header.template.workout(ftp: header.ftp), startDate: header.startDate,
        state: state, samples: samples)
    }
  }

  /// Where journals are kept unless told otherwise.
  public static var defaultDirectory: URL {
    URL.applicationSupportDirectory.appending(path: "Ride in progress", directoryHint: .isDirectory)
  }

  private static let fileName = "ride.jsonl"

  private let url: URL
  private var handle: FileHandle?
  private let encoder = JSONEncoder()

  /// Starts a journal in `directory`, replacing any already there. Nil if it cannot be created.
  public init?(directory: URL = defaultDirectory, header: Header) {
    url = directory.appending(path: Self.fileName)
    do {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      FileManager.default.createFile(atPath: url.path, contents: nil)
      handle = try FileHandle(forWritingTo: url)
    } catch {
      return nil
    }
    write(header)
  }

  /// Carries on the journal in `directory` after a crash, adding to what it holds. Nil if there
  /// is none.
  public init?(resuming directory: URL = defaultDirectory) {
    url = directory.appending(path: Self.fileName)
    do {
      let handle = try FileHandle(forWritingTo: url)
      try handle.seekToEnd()
      // Ends a line the crash cut short, so it does not run into the next.
      try handle.write(contentsOf: Data("\n".utf8))
      self.handle = handle
    } catch {
      return nil
    }
  }

  deinit { try? handle?.close() }

  public func append(_ entry: Entry) { write(entry) }

  /// Closes the journal and deletes it, once the ride is over and kept or thrown away.
  public func finish() {
    try? handle?.close()
    handle = nil
    try? FileManager.default.removeItem(at: url)
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

  // MARK: Recovery

  /// The ride a journal in `directory` was left holding, or nil if there is none or it never
  /// recorded anything.
  public static func recover(from directory: URL = defaultDirectory) -> Interrupted? {
    guard let data = try? Data(contentsOf: directory.appending(path: fileName)) else { return nil }
    let decoder = JSONDecoder()
    var lines = data.split(separator: UInt8(ascii: "\n")).makeIterator()
    guard let first = lines.next(), let header = try? decoder.decode(Header.self, from: first)
    else { return nil }
    var state: RideSession.State?
    var samples: [RideSession.LiveSample] = []
    while let line = lines.next() {
      guard let entry = try? decoder.decode(Entry.self, from: line) else { continue }
      state = entry.state
      if let sample = entry.sample { samples.append(sample) }
    }
    guard let state, !samples.isEmpty else { return nil }
    return Interrupted(header: header, state: state, samples: samples)
  }

  /// Deletes the journal in `directory`, whatever it holds.
  public static func discard(in directory: URL = defaultDirectory) {
    try? FileManager.default.removeItem(at: directory.appending(path: fileName))
  }
}
